#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { FigmaClient, parseFigmaLink, type FigmaLink } from './figma/client.js';
import type { FNode, FNodesResponse } from './figma/types.js';
import { renderSvg } from './figma/svg.js';
import { addAssets, hasDependency, packageName } from './pubspec.js';
import { normalizeResponse } from './figma/normalize.js';
import { parseFigma } from './figma/parse.js';
import { checkHealth, formatReport } from './health.js';
import { generateFlutter } from './gen/flutter/emit.js';
import { goldenTest } from './gen/flutter/golden.js';

const HELP = `pixelproof: design to code for Figma. Flutter screens, verified against your design.

Usage:
  pixelproof check <figma-link>            Design health check (what to fix before converting)
  pixelproof pull  <figma-link> [options]  Generate Flutter code into your project

Options:
  --out <dir>        Flutter project root (default: current folder)
  --fixture <file>   Use a saved Figma JSON response instead of the API
  --fixed-width      Keep the design's fixed width instead of filling the screen
  --no-scroll        Do not wrap the screen in a scroll view
  --no-assets        Skip downloading icons and images
  --keep-system-ui   Keep status bar / home indicator layers (left out by default)
  --token <token>    Figma personal access token (or set FIGMA_TOKEN)
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: '.' },
      fixture: { type: 'string' },
      token: { type: 'string' },
      'fixed-width': { type: 'boolean', default: false },
      'no-scroll': { type: 'boolean', default: false },
      'no-assets': { type: 'boolean', default: false },
      'keep-system-ui': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, link] = positionals;
  if (values.help || !cmd || !['check', 'pull'].includes(cmd)) { console.log(HELP); process.exit(cmd ? 1 : 0); }

  let resp: FNodesResponse;
  let target: FigmaLink;
  let client: FigmaClient | undefined;
  if (values.fixture) {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(values.fixture, 'utf8')); }
    catch (e) { throw new Error(`Could not read ${values.fixture} as JSON: ${e instanceof Error ? e.message : e}`); }
    const parsedLink = link ? parseFigmaLink(link) : undefined;
    const norm = normalizeResponse(raw, parsedLink?.nodeId);
    resp = norm.resp;
    target = { fileKey: parsedLink?.fileKey ?? 'fixture', nodeId: norm.nodeId };
    console.log(`Using node ${norm.nodeId} ("${resp.nodes[norm.nodeId]!.document.name}") from ${values.fixture}\n`);
  } else {
    if (!link) throw new Error('Pass a Figma link: right-click a frame > Copy link to selection.');
    const token = values.token ?? process.env.FIGMA_TOKEN;
    if (!token) throw new Error('Set FIGMA_TOKEN (Figma > Settings > Security > Personal access tokens, read-only file scope).');
    target = parseFigmaLink(link);
    client = new FigmaClient({ token, cacheDir: join(homedir(), '.cache', 'pixelproof'), log: m => console.error(m) });
    resp = await client.nodes(target);
  }

  const entry = resp.nodes[target.nodeId] ?? Object.values(resp.nodes)[0];
  if (!entry) throw new Error(`Node ${target.nodeId} not found.`);
  const health = checkHealth(entry.document);
  console.log(formatReport(health));
  if (cmd === 'check') return;

  const doc = parseFigma(resp, target.nodeId, target.fileKey, { keepSystemUi: values['keep-system-ui'] });
  const out = generateFlutter(doc, { responsiveWidth: !values['fixed-width'], scroll: !values['no-scroll'] });
  const genDir = join(values.out!, 'lib', 'generated');
  await mkdir(genDir, { recursive: true });
  await writeFile(join(genDir, out.screenFile), out.code);
  await writeFile(join(genDir, 'app_tokens.g.dart'), out.tokensCode);

  const pubspecPath = join(values.out!, 'pubspec.yaml');
  const pubspec = await readFile(pubspecPath, 'utf8').catch(() => null);
  const pkg = (pubspec && packageName(pubspec)) ?? 'your_app';
  const testDir = join(values.out!, 'test', 'pixelproof');
  await mkdir(testDir, { recursive: true });
  const goldenFile = `${out.screenFile.replace(/\.g\.dart$/, '')}_golden_test.dart`;
  await writeFile(join(testDir, goldenFile), goldenTest(doc, out.screenClass, out.screenFile, pkg));

  let downloaded = 0;
  const downloadedFiles = new Set<string>();
  if (client && !values['no-assets'] && doc.assets.length) {
    const svgIds = doc.assets.filter(a => a.format === 'svg' && !a.imageRef).map(a => a.nodeId);
    const pngIds = doc.assets.filter(a => a.format === 'png' && !a.imageRef).map(a => a.nodeId);
    const rendered = {
      ...(svgIds.length ? await client.renderImages(target.fileKey, svgIds, 'svg') : {}),
      ...(pngIds.length ? await client.renderImages(target.fileKey, pngIds, 'png', 3) : {}),
    };
    const fills = doc.assets.some(a => a.imageRef) ? await client.imageFills(target.fileKey) : {};
    for (const a of doc.assets) {
      const url = a.imageRef ? fills[a.imageRef] : rendered[a.nodeId];
      if (!url) { console.error(`  could not export ${a.file}`); continue; }
      const dest = join(values.out!, a.file);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await client.download(url));
      downloadedFiles.add(a.file);
      downloaded++;
    }
  }

  // Any asset not downloaded (fixture mode, export failure) gets a grey placeholder,
  // so the app still runs instead of throwing "Unable to load asset".
  // Next best: draw SVG icons ourselves from the vector geometry inside the JSON.
  let placeholders = 0, drawn = 0;
  const byId = new Map<string, FNode>();
  const index = (n: FNode) => { byId.set(n.id, n); n.children?.forEach(index); };
  index(entry.document);
  for (const a of doc.assets) {
    const dest = join(values.out!, a.file);
    if (downloadedFiles.has(a.file)) continue;
    await mkdir(dirname(dest), { recursive: true });
    const raw = byId.get(a.nodeId);
    const svg = a.format === 'svg' && raw ? renderSvg(raw) : null;
    if (svg) { await writeFile(dest, svg); drawn++; continue; }
    await writeFile(dest, a.format === 'svg' ? PLACEHOLDER_SVG : PLACEHOLDER_PNG);
    placeholders++;
  }

  console.log(`\nWrote lib/generated/${out.screenFile} (${out.screenClass}), lib/generated/app_tokens.g.dart and test/pixelproof/${goldenFile}`);
  if (doc.assets.length) {
    const parts = [downloaded && `${downloaded} downloaded from Figma`, drawn && `${drawn} drawn from the JSON geometry`, placeholders && `${placeholders} grey placeholder(s) (images need the Figma API)`].filter(Boolean);
    console.log(`Assets (${doc.assets.length}): ${parts.join(', ')}`);
  }
  if (doc.omitted.length) console.log(`Left out as system UI: ${doc.omitted.join(', ')} (use --keep-system-ui to include)`);
  if (doc.fonts.length) console.log(`Fonts used (bundle these in pubspec.yaml): ${doc.fonts.join(', ')}`);
  if (out.warnings.length) console.log(`${out.warnings.length} item(s) not generated yet; listed at the top of the file.`);

  // Make the project runnable: register asset folders, then say exactly what is left.
  const next: string[] = [];
  const outDir = values.out === '.' ? 'this folder' : values.out!;
  if (pubspec === null) {
    console.log(`\n⚠ ${outDir} has no pubspec.yaml, so it is not a Flutter project and cannot run.`);
    next.push(`flutter create ${values.out === '.' ? '.' : JSON.stringify(values.out)}   (creates the missing project files; keeps the generated ones)`, 'run this pixelproof pull command again');
  } else {
    const { yaml, added } = addAssets(pubspec, out.pubspecAssets);
    if (added.length) { await writeFile(pubspecPath, yaml); console.log(`Updated pubspec.yaml: added ${added.join(', ')} to flutter > assets`); }
    const missing = out.dependencies.filter(d => !hasDependency(pubspec, d));
    if (missing.length) next.push(`flutter pub add ${missing.join(' ')}`);
    next.push(`set home: const ${out.screenClass}() in lib/main.dart (import 'generated/${out.screenFile}')`, 'flutter run');
  }
  console.log(`\nNext:\n${next.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
}

const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="#C4C4C4"/></svg>\n';
// 1x1 grey PNG
const PLACEHOLDER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4dur/fwAHmgNLDwbx2wAAAABJRU5ErkJggg==', 'base64');

main().catch(e => {
  console.error(`pixelproof: ${e instanceof Error ? e.message : e}`);
  if (process.env.PIXELPROOF_DEBUG && e instanceof Error) console.error(e.stack);
  else console.error('(set PIXELPROOF_DEBUG=1 for details)');
  process.exit(1);
});
