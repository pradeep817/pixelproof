import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeResponse } from '../src/figma/normalize.js';
import { parseFigma } from '../src/figma/parse.js';
import { generateFlutter } from '../src/gen/flutter/emit.js';

const login = JSON.parse(readFileSync(new URL('./fixtures/login.json', import.meta.url), 'utf8'));
const screen = login.nodes['1:2'].document;

test('normalize: nodes response passes through', () => {
  const { nodeId } = normalizeResponse(structuredClone(login));
  assert.equal(nodeId, '1:2');
});

test('normalize: whole-file response picks the first screen frame', () => {
  const file = { name: 'App', document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '0:1', type: 'CANVAS', name: 'Page 1', children: [structuredClone(screen)] }] }, styles: login.nodes['1:2'].styles, components: {} };
  const { resp, nodeId } = normalizeResponse(file);
  assert.equal(nodeId, '1:2');
  assert.equal(resp.nodes[nodeId]!.document.name, 'Login');
});

test('normalize: a single node, or an array of nodes', () => {
  assert.equal(normalizeResponse(structuredClone(screen)).nodeId, '1:2');
  assert.equal(normalizeResponse([structuredClone(screen)]).nodeId, '1:2');
});

test('normalize: clear error for unrecognised JSON', () => {
  assert.throws(() => normalizeResponse({ hello: 'world' }), /Unrecognised Figma JSON/);
  assert.throws(() => normalizeResponse({ nodes: { '1:2': null } }), /"nodes" is empty/);
});

test('normalize: plugin-API export (relative x/y, fontName, lineHeight objects) generates code', () => {
  const otp = {
    type: 'FRAME', name: 'OTP Verification', x: 0, y: 0, width: 390, height: 844,
    layoutMode: 'VERTICAL', itemSpacing: 24, paddingLeft: 24, paddingRight: 24, paddingTop: 80, paddingBottom: 24,
    primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
    children: [
      { type: 'TEXT', name: 'Title', x: 24, y: 80, width: 200, height: 32, characters: 'Verify your number',
        fontSize: 24, fontName: { family: 'Poppins', style: 'SemiBold' }, lineHeight: { unit: 'PIXELS', value: 32 },
        letterSpacing: { unit: 'PERCENT', value: -1 }, textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: [{ type: 'SOLID', color: { r: 0.07, g: 0.09, b: 0.15 } }] },
      { type: 'FRAME', name: 'Code boxes', x: 24, y: 136, width: 342, height: 56, layoutMode: 'HORIZONTAL', itemSpacing: 12,
        layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', fills: [],
        children: [0, 1, 2, 3].map(i => ({
          type: 'FRAME', name: 'Digit', x: i * 94.5, y: 0, width: 76.5, height: 56, layoutSizingHorizontal: 'FILL',
          cornerRadius: 12, strokes: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.92 } }], strokeWeight: 1,
          layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', fills: [],
          children: [{ type: 'TEXT', name: 'Digit text', x: 32, y: 14, width: 12, height: 28, characters: `${i + 1}`,
            fontSize: 20, fontName: { family: 'Poppins', style: 'Medium' }, lineHeight: { unit: 'AUTO' }, textAutoResize: 'WIDTH_AND_HEIGHT',
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] }],
        })),
      },
    ],
  };
  const { resp, nodeId } = normalizeResponse(otp);
  const doc = parseFigma(resp, nodeId, 'plugin');
  const boxes = doc.root.children[1];
  assert.equal(boxes.box.y, 136);
  assert.equal(boxes.children[2].box.x, 24 + 2 * 94.5); // relative x became absolute
  const title = doc.root.children[0].text!.style;
  assert.equal(title.fontWeight, 600);
  assert.equal(title.lineHeightPx, 32);
  assert.equal(title.letterSpacingPx, -0.24);
  assert.equal(doc.root.children[1].children[0].children[0].text!.style.lineHeightPx, undefined);
  const code = generateFlutter(doc).code;
  assert.match(code, /class OtpVerificationScreen/);
  assert.match(code, /'Verify your number'/);
  assert.equal((code.match(/Expanded\(/g) ?? []).length, 4);
});
