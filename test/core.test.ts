import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseFigma } from '../src/figma/parse.js';
import { parseFigmaLink, FigmaClient } from '../src/figma/client.js';
import { checkHealth } from '../src/health.js';
import { generateFlutter, flutterBlur } from '../src/gen/flutter/emit.js';
import type { FNodesResponse, FNode } from '../src/figma/types.js';

const login: FNodesResponse = JSON.parse(readFileSync(new URL('./fixtures/login.json', import.meta.url), 'utf8'));
const doc = parseFigma(login, '1:2', 'abc');
const out = generateFlutter(doc);
const code = out.code;

// ------------------------------------------------------------------ parser

test('parser: auto layout sizing (fill / hug / fixed)', () => {
  const header = doc.root.children.find(c => c.name === 'Header')!;
  assert.equal(header.width, 'fill');
  assert.equal(header.height, 'hug');
  assert.equal(header.layout.mode, 'column');
  assert.equal(header.layout.gap, 8);
  const title = header.children[0];
  assert.equal(title.kind, 'text');
  assert.equal(title.width, 'hug');
});

test('parser: named styles become tokens', () => {
  assert.deepEqual(doc.colors.map(c => c.name).sort(), ['borderDefault', 'primary500', 'surfaceBase', 'textMuted', 'textPrimary']);
  assert.ok(doc.textStyles.some(t => t.name === 'headingH1' && t.style.letterSpacingPx === -0.56));
});

test('parser: icons and vector-only frames become SVG assets with unique names', () => {
  const files = doc.assets.map(a => a.file);
  assert.ok(files.includes('assets/icons/logo.svg'));
  assert.ok(files.includes('assets/icons/icon_mail.svg'));
  assert.equal(new Set(files).size, files.length);
});

test('parser: absolute child keeps its constraints', () => {
  const glow = doc.root.children.find(c => c.name === 'Glow')!;
  assert.equal(glow.absolute, true);
  assert.equal(glow.constraints.h, 'end');
});

test('parser: hidden layers are dropped', () => {
  const r = structuredClone(login);
  r.nodes['1:2']!.document.children![2].visible = false;
  const d = parseFigma(r, '1:2', 'abc');
  assert.ok(!d.root.children.some(c => c.name === 'Header'));
});

// ------------------------------------------------------------------ conversion rules

test('rule: line height becomes height ratio with even leading', () => {
  assert.match(out.tokensCode, /static const headingH1 = TextStyle\([\s\S]*?height: 1\.2857,[\s\S]*?leadingDistribution: TextLeadingDistribution\.even/);
});

test('rule: inside stroke is subtracted from padding (Figma strokes do not move content)', () => {
  assert.match(code, /class Input[\s\S]*?padding: const EdgeInsets\.all\(15\)/);
});

test('rule: fill on main axis becomes Expanded, fill on cross axis becomes double.infinity', () => {
  assert.match(code, /Expanded\(\s*child: Text\(placeholder/);
  assert.match(code, /class Input[\s\S]*?width: double\.infinity/);
});

test('rule: absolute children are positioned against the outer box, padding moves inside the Stack', () => {
  assert.match(code, /Stack\(\s*children: \[\s*Padding\(\s*padding: const EdgeInsets\.fromLTRB\(24, 64, 24, 32\)/);
  assert.match(code, /Positioned\(\s*right: -60,\s*width: 220,\s*top: -60,\s*height: 220/);
});

test('rule: Figma shadow blur converts to Flutter blurRadius via sigma', () => {
  assert.equal(Math.round(flutterBlur(12) * 100) / 100, 9.53);
  assert.equal(flutterBlur(0), 0);
  assert.match(code, /blurRadius: 9\.53/);
});

test('rule: tokens are referenced, not hard-coded', () => {
  assert.match(code, /AppColors\.primary500/);
  assert.match(code, /style: AppTextStyles\.headingH1/);
  assert.match(code, /AppTextStyles\.labelMedium\.copyWith\(color: AppColors\.textPrimary\)/);
});

test('rule: components become reusable widgets; swapped icons and texts are parameters', () => {
  assert.match(code, /class Input extends StatelessWidget/);
  assert.match(code, /Input\(\s*placeholder: 'Email address',\s*icon: 'assets\/icons\/icon_mail\.svg',?\s*\)/);
  assert.match(code, /Input\(placeholder: 'Password', icon: 'assets\/icons\/icon_lock\.svg'\)/);
  assert.equal((code.match(/class Input /g) ?? []).length, 1);
  assert.match(code, /class ButtonPrimary[\s\S]*?final VoidCallback\? onTap;/);
});

test('rule: overridden instance is inlined instead of breaking the shared widget', () => {
  const r = structuredClone(login);
  const form = r.nodes['1:2']!.document.children![3];
  form.children![1].cornerRadius = 4; // second Input overrides radius
  const c = generateFlutter(parseFigma(r, '1:2', 'abc')).code;
  assert.match(c, /Input\(\s*placeholder: 'Email address'/);
  assert.doesNotMatch(c, /Input\(placeholder: 'Password'/);
  assert.match(c, /Radius\.circular\(4\)/);
});

test('rule: apostrophes use double-quoted Dart strings', () => {
  assert.match(code, /Text\("Don't have an account\?"/);
});

// ------------------------------------------------------------------ output sanity

test('output: Dart is structurally valid (balanced, no JS leakage)', () => {
  for (const src of [code, out.tokensCode]) {
    const stripped = src.replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    for (const ch of stripped) {
      if ('([{'.includes(ch)) stack.push(ch);
      else if (ch in pairs) assert.equal(stack.pop(), pairs[ch], 'mismatched bracket');
    }
    assert.equal(stack.length, 0, 'unclosed bracket');
    assert.doesNotMatch(src, /undefined|NaN|\[object |Infinity(?!\w)/);
  }
});

test('output: same input gives byte-identical output (deterministic)', () => {
  assert.equal(generateFlutter(parseFigma(login, '1:2', 'abc')).code, code);
});

test('output: matches the reviewed snapshot', () => {
  const dir = new URL('./__snapshots__/', import.meta.url);
  const file = new URL('login.g.dart', dir);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, code);
  }
  assert.equal(code, readFileSync(file, 'utf8'), 'Generated code changed. Review it, then run UPDATE_SNAPSHOTS=1 npm test.');
});

// ------------------------------------------------------------------ health check

test('health: flags default names and missing auto layout, not intentional names', () => {
  const r = checkHealth(login.nodes['1:2']!.document);
  assert.ok(r.issues.some(i => i.rule === 'default-name' && i.nodeName === 'Frame 12'));
  assert.ok(!r.issues.some(i => i.nodeName === 'Line'));
  const messy: FNode = {
    id: '9:1', name: 'Frame 3', type: 'FRAME', children: [
      { id: '9:2', name: 'Rectangle 1', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } },
      { id: '9:3', name: 'Rectangle 2', type: 'RECTANGLE', absoluteBoundingBox: { x: 5, y: 5, width: 10, height: 10 } },
    ],
  };
  const m = checkHealth(messy);
  assert.ok(m.issues.some(i => i.rule === 'no-auto-layout'));
  assert.ok(m.issues.some(i => i.rule === 'overlap'));
  assert.ok(m.score < r.score);
});

// ------------------------------------------------------------------ client

test('client: parses design and file links, rejects links without a node', () => {
  assert.deepEqual(parseFigmaLink('https://www.figma.com/design/AbC123/Auth?node-id=1-2&t=x'), { fileKey: 'AbC123', nodeId: '1:2' });
  assert.deepEqual(parseFigmaLink('https://www.figma.com/file/XyZ/App?node-id=10%3A5'), { fileKey: 'XyZ', nodeId: '10:5' });
  assert.throws(() => parseFigmaLink('https://www.figma.com/design/AbC123/Auth'), /node-id/);
});

test('client: retries on 429 using Retry-After, then succeeds', async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
    return Response.json({ version: '7' });
  }) as typeof fetch;
  const c = new FigmaClient({ token: 't', fetchImpl: fake });
  assert.equal(await c.version('k'), '7');
  assert.equal(calls, 2);
});

test('client: clear message on 403', async () => {
  const fake = (async () => new Response('no', { status: 403 })) as typeof fetch;
  await assert.rejects(new FigmaClient({ token: 't', fetchImpl: fake }).version('k'), /refused access/);
});
