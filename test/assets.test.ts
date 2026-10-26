import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAssetNode, assetFormat } from '../src/figma/assets.js';
import { checkHealth, formatReport } from '../src/health.js';
import { normalizeResponse } from '../src/figma/normalize.js';
import { parseFigma } from '../src/figma/parse.js';
import { generateFlutter } from '../src/gen/flutter/emit.js';
import type { FNode } from '../src/figma/types.js';

const bb = (x: number, y: number, w: number, h: number) => ({ absoluteBoundingBox: { x, y, width: w, height: h } });

/** Like an exported icon: a frame of clip-path groups, each a mask rectangle plus vectors. */
const clipGroup = (i: number): FNode => ({
  id: `c:${i}`, name: 'Clip path group', type: 'GROUP', ...bb(10, 10, 100, 100),
  children: [
    { id: `m:${i}`, name: 'clip0', type: 'RECTANGLE', isMask: true, ...bb(10, 10, 100, 100) },
    { id: `v:${i}`, name: 'Vector', type: 'VECTOR', ...bb(20, 20, 80, 80) },
  ],
});
const bankIcon: FNode = { id: 'i:1', name: 'Bank guidance icon', type: 'FRAME', ...bb(10, 10, 120, 120), children: [0, 1, 2, 3, 4, 5, 6].map(clipGroup) };

test('assets: clip-path groups with masks are one icon', () => {
  assert.equal(isAssetNode(bankIcon), true);
  assert.equal(isAssetNode(clipGroup(1)), true);
  assert.equal(assetFormat(bankIcon), 'svg');
});

test('assets: a progress bar made of rectangles stays widgets; text blocks are never icons', () => {
  const bar: FNode = { id: 'p', name: 'Progress', type: 'FRAME', ...bb(0, 0, 300, 8), children: [
    { id: 'p1', name: 'Track', type: 'RECTANGLE', ...bb(0, 0, 300, 8) }, { id: 'p2', name: 'Fill', type: 'RECTANGLE', ...bb(0, 0, 120, 8) }] };
  const label: FNode = { id: 't', name: 'Icon label', type: 'FRAME', ...bb(0, 0, 40, 40), children: [
    { id: 't1', name: 'Vector', type: 'VECTOR', ...bb(0, 0, 20, 20) }, { id: 't2', name: 'Hi', type: 'TEXT', characters: 'Hi', ...bb(0, 20, 20, 20) }] };
  assert.equal(isAssetNode(bar), false);
  assert.equal(isAssetNode(label), false);
});

test('assets: drawings with bitmaps export as PNG and render with Image.asset', () => {
  const emblem: FNode = { id: 'e', name: 'Bank emblem', type: 'GROUP', ...bb(0, 0, 80, 80), children: [
    { id: 'e1', name: 'mask', type: 'RECTANGLE', isMask: true, ...bb(0, 0, 80, 80) },
    { id: 'e2', name: 'photo', type: 'RECTANGLE', ...bb(0, 0, 80, 80), fills: [{ type: 'IMAGE', imageRef: 'abc' }] }] };
  assert.equal(isAssetNode(emblem), true);
  assert.equal(assetFormat(emblem), 'png');
  const screen: FNode = { id: 's', name: 'OTP', type: 'FRAME', ...bb(0, 0, 390, 844), layoutMode: 'VERTICAL', children: [emblem, bankIcon] };
  const { resp, nodeId } = normalizeResponse(screen);
  const code = generateFlutter(parseFigma(resp, nodeId, 'k')).code;
  assert.match(code, /Image\.asset\(\s*'assets\/images\/bank_emblem\.png'/);
  assert.match(code, /SvgPicture\.asset\(\s*'assets\/icons\/bank_guidance_icon\.svg'/);
  assert.doesNotMatch(code, /clip_path_group/);
});

test('health: skips icon internals and collapses repeated issues', () => {
  const texts: FNode[] = [1, 2, 3, 4, 5, 6].map(i => ({ id: `d${i}`, name: `OTP digit ${i}`, type: 'TEXT', characters: `${i}`, ...bb(0, 0, 10, 20) }));
  const screen: FNode = { id: 's', name: 'OTP', type: 'FRAME', ...bb(0, 0, 390, 844), layoutMode: 'VERTICAL', children: [bankIcon, ...texts] };
  const r = checkHealth(screen);
  assert.ok(!r.issues.some(i => i.nodeName === 'Clip path group'), 'icon internals must not be checked');
  const report = formatReport(r);
  assert.match(report, /\[raw-text-style\] 6 layers \("OTP digit 1", "OTP digit 2", "OTP digit 3" and 3 more\)/);
  assert.ok(r.score >= 88, `score ${r.score}: six unstyled texts are one fix, not six`);
});
