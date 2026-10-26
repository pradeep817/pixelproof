// Builds test/fixtures/login.json: a Login screen in the exact shape of
// GET /v1/files/:key/nodes (coordinates, auto layout fields, styles, components).
import { writeFileSync } from 'node:fs';

const hex = h => ({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 });
const solid = h => [{ type: 'SOLID', color: hex(h) }];
const box = (x, y, width, height) => ({ absoluteBoundingBox: { x, y, width, height }, constraints: { vertical: 'TOP', horizontal: 'LEFT' } });
let id = 100;
const nid = () => `1:${id++}`;

const C = { primary: '4F46E5', text: '111827', muted: '6B7280', border: 'E5E7EB', white: 'FFFFFF' };

const text = (name, chars, x, y, w, h, o) => ({
  id: nid(), name, type: 'TEXT', characters: chars, ...box(x, y, w, h),
  textAutoResize: o.resize ?? 'WIDTH_AND_HEIGHT',
  fills: solid(o.color), styles: { fill: o.colorStyle, text: o.textStyle },
  style: { fontFamily: 'Inter', fontWeight: o.weight ?? 400, fontSize: o.size, lineHeightPx: o.lh, lineHeightUnit: 'PIXELS', letterSpacing: o.ls ?? 0, textAlignHorizontal: o.align ?? 'LEFT' },
  ...(o.sizing ?? {}),
});

const icon = (name, x, y) => ({
  id: nid(), name, type: 'FRAME', ...box(x, y, 20, 20), fills: [],
  children: [{ id: nid(), name: 'Vector', type: 'VECTOR', ...box(x + 2, y + 2, 16, 16), fills: solid(C.muted) }],
});

const input = (iconName, placeholder, y) => ({
  id: nid(), name: 'Input', type: 'INSTANCE', componentId: 'C:input', ...box(24, y, 342, 56),
  layoutMode: 'HORIZONTAL', itemSpacing: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 16, paddingBottom: 16,
  counterAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED',
  fills: solid(C.white), styles: { fill: 'S:white', stroke: 'S:border' },
  strokes: solid(C.border), strokeWeight: 1, strokeAlign: 'INSIDE', cornerRadius: 12,
  children: [
    icon(iconName, 40, y + 18),
    text('Placeholder', placeholder, 72, y + 16, 278, 24, { color: C.muted, colorStyle: 'S:muted', textStyle: 'S:body', size: 16, lh: 24, resize: 'HEIGHT', sizing: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' } }),
  ],
});

const social = (iconName, label, x) => ({
  id: nid(), name: 'Button/Social', type: 'INSTANCE', componentId: 'C:social', ...box(x, 536, 165, 48),
  layoutMode: 'HORIZONTAL', itemSpacing: 8, primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
  layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED',
  fills: solid(C.white), styles: { fill: 'S:white', stroke: 'S:border' },
  strokes: solid(C.border), strokeWeight: 1, strokeAlign: 'INSIDE', cornerRadius: 12,
  children: [
    icon(iconName, x + 44.5, 550),
    text('Label', label, x + 72.5, 548, 48, 20, { color: C.text, colorStyle: 'S:text', textStyle: 'S:label', size: 14, lh: 20, weight: 500 }),
  ],
});

const line = x => ({
  id: nid(), name: 'Line', type: 'RECTANGLE', ...box(x, 501, 104, 1), fills: solid(C.border), styles: { fill: 'S:border' },
  layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED',
});

const root = {
  id: '1:2', name: 'Login', type: 'FRAME', ...box(0, 0, 390, 844), clipsContent: true,
  layoutMode: 'VERTICAL', itemSpacing: 24, paddingLeft: 24, paddingRight: 24, paddingTop: 64, paddingBottom: 32,
  primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
  fills: solid(C.white), styles: { fill: 'S:white' },
  children: [
    {
      id: nid(), name: 'Glow', type: 'ELLIPSE', layoutPositioning: 'ABSOLUTE', ...box(230, -60, 220, 220),
      constraints: { vertical: 'TOP', horizontal: 'RIGHT' },
      fills: [{ type: 'GRADIENT_RADIAL', gradientHandlePositions: [{ x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }],
        gradientStops: [{ color: { ...hex(C.primary), a: 0.25 }, position: 0 }, { color: { ...hex(C.primary), a: 0 }, position: 1 }] }],
    },
    { id: nid(), name: 'Logo', type: 'FRAME', ...box(24, 64, 48, 48), fills: [], exportSettings: [{ format: 'SVG' }],
      children: [{ id: nid(), name: 'Mark', type: 'BOOLEAN_OPERATION', ...box(28, 68, 40, 40), fills: solid(C.primary) }] },
    {
      id: nid(), name: 'Header', type: 'FRAME', ...box(24, 136, 342, 68), fills: [],
      layoutMode: 'VERTICAL', itemSpacing: 8, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
      children: [
        text('Title', 'Welcome back', 24, 136, 186, 36, { color: C.text, colorStyle: 'S:text', textStyle: 'S:h1', size: 28, lh: 36, weight: 700, ls: -0.56 }),
        text('Subtitle', 'Sign in to continue to your account', 24, 180, 342, 24, { color: C.muted, colorStyle: 'S:muted', textStyle: 'S:body', size: 16, lh: 24, resize: 'HEIGHT', sizing: { layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' } }),
      ],
    },
    {
      id: nid(), name: 'Form', type: 'FRAME', ...box(24, 228, 342, 164), fills: [],
      layoutMode: 'VERTICAL', itemSpacing: 16, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
      children: [
        input('Icon/Mail', 'Email address', 228),
        input('Icon/Lock', 'Password', 300),
        {
          id: nid(), name: 'Forgot row', type: 'FRAME', ...box(24, 372, 342, 20), fills: [],
          layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'MAX', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
          children: [text('Forgot', 'Forgot password?', 246, 372, 120, 20, { color: C.primary, colorStyle: 'S:primary', textStyle: 'S:label', size: 14, lh: 20, weight: 500 })],
        },
      ],
    },
    {
      id: nid(), name: 'Button/Primary', type: 'INSTANCE', componentId: 'C:btn', ...box(24, 416, 342, 52),
      layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
      layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', cornerRadius: 12,
      fills: solid(C.primary), styles: { fill: 'S:primary' },
      effects: [{ type: 'DROP_SHADOW', visible: true, color: { ...hex(C.primary), a: 0.3 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0 }],
      children: [text('Label', 'Sign in', 167, 430, 56, 24, { color: C.white, colorStyle: 'S:white', textStyle: 'S:button', size: 16, lh: 24, weight: 600 })],
    },
    {
      id: nid(), name: 'Divider', type: 'FRAME', ...box(24, 492, 342, 20), fills: [],
      layoutMode: 'HORIZONTAL', itemSpacing: 12, counterAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
      children: [line(24), text('Or', 'or continue with', 140, 492, 110, 20, { color: C.muted, colorStyle: 'S:muted', textStyle: 'S:caption', size: 14, lh: 20 }), line(262)],
    },
    {
      id: nid(), name: 'Frame 12', type: 'FRAME', ...box(24, 536, 342, 48), fills: [],
      layoutMode: 'HORIZONTAL', itemSpacing: 12, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
      children: [social('Icon/Google', 'Google', 24), social('Icon/Apple', 'Apple', 201)],
    },
    {
      id: nid(), name: 'Footer', type: 'FRAME', ...box(24, 608, 342, 20), fills: [],
      layoutMode: 'HORIZONTAL', itemSpacing: 4, primaryAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
      children: [
        text('Prompt', "Don't have an account?", 89, 608, 158, 20, { color: C.muted, colorStyle: 'S:muted', textStyle: 'S:caption', size: 14, lh: 20 }),
        text('Sign up', 'Sign up', 251, 608, 50, 20, { color: C.primary, colorStyle: 'S:primary', textStyle: 'S:label', size: 14, lh: 20, weight: 500 }),
      ],
    },
  ],
};

const styles = {
  'S:white': { key: 'k1', name: 'Surface/Base', styleType: 'FILL' },
  'S:primary': { key: 'k2', name: 'Primary/500', styleType: 'FILL' },
  'S:text': { key: 'k3', name: 'Text/Primary', styleType: 'FILL' },
  'S:muted': { key: 'k4', name: 'Text/Muted', styleType: 'FILL' },
  'S:border': { key: 'k5', name: 'Border/Default', styleType: 'FILL' },
  'S:h1': { key: 'k6', name: 'Heading/H1', styleType: 'TEXT' },
  'S:body': { key: 'k7', name: 'Body/Regular', styleType: 'TEXT' },
  'S:label': { key: 'k8', name: 'Label/Medium', styleType: 'TEXT' },
  'S:button': { key: 'k9', name: 'Button/Label', styleType: 'TEXT' },
  'S:caption': { key: 'k10', name: 'Caption/Regular', styleType: 'TEXT' },
};
const components = {
  'C:input': { key: 'ck1', name: 'Input' },
  'C:btn': { key: 'ck2', name: 'Button/Primary' },
  'C:social': { key: 'ck3', name: 'Button/Social' },
};

const resp = { name: 'Auth flows', version: '42', nodes: { '1:2': { document: root, styles, components } } };
writeFileSync(new URL('./login.json', import.meta.url), JSON.stringify(resp, null, 2));
console.log('wrote login.json');
