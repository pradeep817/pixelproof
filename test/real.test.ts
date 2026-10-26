// Regression tests from real exported screens (test/fixtures/real/*.json).
// Those files are client designs and are not committed; these tests skip when they are absent.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { normalizeResponse } from '../src/figma/normalize.js';
import { parseFigma } from '../src/figma/parse.js';
import { generateFlutter } from '../src/gen/flutter/emit.js';
import { checkHealth } from '../src/health.js';
import { renderSvg } from '../src/figma/svg.js';
import type { FNode } from '../src/figma/types.js';
import type { IRNode } from '../src/ir.js';

const SCREENS = ['otp', 'onboarding', 'passcode'] as const;
const load = (name: string) => {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/real/${name}.json`, import.meta.url), 'utf8'));
  const { resp, nodeId } = normalizeResponse(raw);
  const doc = parseFigma(resp, nodeId, name);
  return { raw: resp.nodes[nodeId]!.document, doc, out: generateFlutter(doc) };
};
const flat = (n: IRNode): IRNode[] => [n, ...n.children.flatMap(flat)];
const flatRaw = (n: FNode): FNode[] => [n, ...(n.children ?? []).flatMap(flatRaw)];
const HAVE_REAL = SCREENS.every(s => existsSync(new URL(`./fixtures/real/${s}.json`, import.meta.url)));
const test = (HAVE_REAL ? nodeTest : nodeTest.skip) as typeof nodeTest;
const lazy = <T>(f: () => T) => { let v: T | undefined; return () => (v ??= f()); };
const getOtp = lazy(() => load('otp'));
const getPasscode = lazy(() => load('passcode'));
const otp = new Proxy({} as ReturnType<typeof load>, { get: (_, k) => getOtp()[k as keyof ReturnType<typeof load>] });
const passcode = new Proxy({} as ReturnType<typeof load>, { get: (_, k) => getPasscode()[k as keyof ReturnType<typeof load>] });

test('real: whole-file exports convert, pick the screen frame, and are deterministic', () => {
  for (const s of SCREENS) {
    const a = load(s);
    assert.match(a.doc.root.name, /^screen_/);
    assert.equal(load(s).out.code, a.out.code, `${s} output must be byte-identical across runs`);
  }
});

test('real: textAutoResize stored inside style is honoured; wrapped text keeps its width', () => {
  const t = flat(otp.doc.root).find(n => n.text?.characters.startsWith('Enter OTP sent'))!;
  assert.equal(t.width, 'fixed');
  assert.match(otp.out.code, /SizedBox\(\s*width: 242,\s*child: Text\(\s*'Enter OTP sent/);
});

test('real: zero-height LINE layers become 1px bars, not invisible SVGs', () => {
  assert.doesNotMatch(otp.out.code, /line_2.*\.svg/);
  assert.match(otp.out.code, /Container\(\s*width: double\.infinity,\s*height: 1,\s*color: const Color\(0xFF707070\)/);
});

test('real: single-character text drops letter spacing (it would shift centred digits)', () => {
  const digit = flat(otp.doc.root).find(n => n.text?.characters === '1')!;
  assert.equal(digit.text!.style.letterSpacingPx, 0);
});

test('real: degenerate gradient falls back to top-to-bottom with ascending stops, and is flagged', () => {
  assert.match(otp.out.code, /LinearGradient\(\s*begin: Alignment\(0, -1\),\s*end: Alignment\(0, 1\),[\s\S]*?stops: \[0, 1\]/);
  assert.ok(otp.out.warnings.some(w => w.includes('gradient direction missing')));
});

test('real: iOS home indicator is left out and reported', () => {
  assert.deepEqual(otp.doc.omitted, ['Home Indicator']);
  assert.doesNotMatch(otp.out.code, /Radius\.circular\(100\)/);
  assert.match(otp.out.code, /Left out \(drawn by the phone, not the app\): Home Indicator/);
  assert.ok(!checkHealth(otp.raw).issues.some(i => i.nodeName === 'Home Indicator'));
});

test('real: free-form screen anchors stretch / centre / right on wider phones', () => {
  const code = otp.out.code;
  assert.match(code, /Positioned\(\s*left: 0,\s*right: 0,\s*top: 0,\s*height: 404,/, 'full-width header stretches');
  assert.match(code, /Positioned\(\s*left: 16,\s*right: 16,\s*top: 300,/, 'card with equal margins stretches');
  assert.match(code, /Positioned\(\s*left: 0,\s*right: 0,\s*top: 72,\s*height: 192,\s*child: Align\(\s*alignment: Alignment\.topCenter/, 'illustration stays centred');
  assert.match(code, /Positioned\(\s*right: 24\.07,\s*width: 22\.93,/, 'emblem stays at the right');
});

test('real: background blur becomes a clipped BackdropFilter', () => {
  const c = passcode.out.code;
  assert.match(c, /^import 'dart:ui' show ImageFilter;/m);
  assert.match(c, /ClipRRect\(\s*borderRadius: const BorderRadius\.all\(Radius\.circular\(8\)\),\s*child: BackdropFilter\(\s*filter: ImageFilter\.blur\(sigmaX: 5, sigmaY: 5\)/);
  assert.ok(!passcode.out.warnings.some(w => w.includes('background blur')));
});

test('real: icons render offline to valid SVG from vector geometry', () => {
  for (const s of SCREENS) {
    const { raw, doc } = load(s);
    const byId = new Map(flatRaw(raw).map(n => [n.id, n]));
    for (const a of doc.assets.filter(x => x.format === 'svg')) {
      const svg = renderSvg(byId.get(a.nodeId)!);
      assert.ok(svg, `${a.file} should render`);
      assert.match(svg!, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+" height="[\d.]+" viewBox="0 0 [\d.]+ [\d.]+"/);
      assert.ok((svg!.match(/<path /g) ?? []).length > 0, `${a.file} has paths`);
      assert.doesNotMatch(svg!, /undefined|NaN/);
      assert.equal((svg!.match(/<g/g) ?? []).length, (svg!.match(/<\/g>/g) ?? []).length, `${a.file} balanced groups`);
    }
  }
});

test('real: health check is not drowned by icon internals', () => {
  const r = checkHealth(otp.raw);
  assert.ok(!r.issues.some(i => i.nodeName === 'Clip path group'));
  assert.ok(r.issues.some(i => i.rule === 'repeat-not-component'));
});

test('real: generated screens match reviewed snapshots', () => {
  const dir = new URL('./__snapshots__/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const s of SCREENS) {
    const file = new URL(`real_${s}.g.dart`, dir);
    const code = load(s).out.code;
    if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) writeFileSync(file, code);
    assert.equal(code, readFileSync(file, 'utf8'), `${s} changed. Review it, then run UPDATE_SNAPSHOTS=1 npm test.`);
  }
});

test('real: tokens file without styles has no unused Flutter import', () => {
  assert.doesNotMatch(otp.out.tokensCode, /import 'package:flutter/);
  assert.match(otp.out.tokensCode, /abstract final class AppColors \{\n\}/);
});
