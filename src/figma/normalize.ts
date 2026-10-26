import type { FNode, FNodesResponse, FTypeStyle } from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Accepts every common shape of Figma JSON and returns the /v1/files/:key/nodes shape:
 *  1. GET /v1/files/:key/nodes          { nodes: { "1:2": { document, styles, components } } }
 *  2. GET /v1/files/:key (whole file)   { document: { children: [canvas...] }, styles, components }
 *  3. A single node                     { id, type: "FRAME", children: [...] }   (or an array of nodes)
 *  4. Figma plugin API exports          x/y/width/height instead of absoluteBoundingBox,
 *                                       fontName / lineHeight / letterSpacing objects, mainComponent
 */
export function normalizeResponse(raw: any, wantedId?: string): { resp: FNodesResponse; nodeId: string } {
  if (raw == null || typeof raw !== 'object') throw new Error(formatHelp('the file is not a JSON object'));

  if (raw.nodes && typeof raw.nodes === 'object') {
    const ids = Object.keys(raw.nodes).filter(k => raw.nodes[k]?.document);
    if (!ids.length) throw new Error(formatHelp('"nodes" is empty (wrong node-id, or no access to the file)'));
    const nodeId = wantedId && raw.nodes[wantedId] ? wantedId : ids[0];
    const entry = raw.nodes[nodeId];
    entry.document = fixTree(entry.document);
    return { resp: raw, nodeId };
  }

  let node: any;
  let styles = raw.styles, components = raw.components;
  if (raw.document && typeof raw.document === 'object') {
    node = (wantedId && findById(raw.document, wantedId)) || firstScreen(raw.document);
    if (!node) throw new Error(formatHelp('the file has no frames'));
  } else if (Array.isArray(raw)) {
    node = raw.find(n => n && typeof n === 'object' && n.type) ?? null;
  } else if (raw.type || raw.children) {
    node = raw;
  } else if (raw.data && typeof raw.data === 'object') {
    return normalizeResponse(raw.data, wantedId); // some exporters wrap the payload
  }
  if (!node) throw new Error(formatHelp('no Figma node found (expected "nodes", "document", or a node with "type")'));

  if (node.type === 'DOCUMENT' || node.type === 'CANVAS') node = firstScreen(node);
  if (!node) throw new Error(formatHelp('no frame found inside the page'));
  const fixed = fixTree(node);
  return {
    resp: { name: raw.name ?? fixed.name, nodes: { [fixed.id]: { document: fixed, styles: styles ?? {}, components: components ?? {} } } },
    nodeId: fixed.id,
  };
}

function formatHelp(reason: string): string {
  return `Unrecognised Figma JSON: ${reason}.
Supported: the response of GET https://api.figma.com/v1/files/<key>/nodes?ids=<node-id>,
the whole-file response of GET /v1/files/<key>, a single exported node, or a plugin export.
Easiest: skip the JSON and pass the Figma link with FIGMA_TOKEN set.`;
}

function findById(n: any, id: string): any {
  if (!n || typeof n !== 'object') return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) { const f = findById(c, id); if (f) return f; }
  return null;
}

/** First top-level frame of the first page that has one. */
function firstScreen(n: any): any {
  const isScreen = (x: any) => ['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(x?.type);
  if (isScreen(n)) return n;
  for (const c of n.children ?? []) if (isScreen(c) && c.type !== 'SECTION') return c;
  for (const c of n.children ?? []) { const f = firstScreen(c); if (f) return f; }
  return null;
}

let autoId = 0;

/** Fills in REST-API fields from plugin-API fields, recursively. */
function fixTree(n: any, originX = 0, originY = 0, parent?: any): FNode {
  if (!n.id) n.id = `auto:${++autoId}`;
  if (!n.name) n.name = n.type ?? 'Layer';
  if (!n.type) n.type = n.characters !== undefined ? 'TEXT' : n.children ? 'FRAME' : 'RECTANGLE';

  if (!n.absoluteBoundingBox && typeof n.width === 'number') {
    n.absoluteBoundingBox = { x: originX + (n.x ?? 0), y: originY + (n.y ?? 0), width: n.width, height: n.height ?? 0 };
  }
  if (!n.absoluteBoundingBox) {
    n.absoluteBoundingBox = parent?.absoluteBoundingBox ? { ...parent.absoluteBoundingBox } : { x: 0, y: 0, width: 0, height: 0 };
  }

  if (!n.componentId && n.mainComponent?.id) n.componentId = n.mainComponent.id;
  if (typeof n.strokeWeight !== 'number') delete n.strokeWeight;
  if (typeof n.cornerRadius !== 'number') {
    if ([n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius].some(v => typeof v === 'number')) {
      n.rectangleCornerRadii = [n.topLeftRadius ?? 0, n.topRightRadius ?? 0, n.bottomRightRadius ?? 0, n.bottomLeftRadius ?? 0];
    }
    delete n.cornerRadius;
  }
  for (const key of ['fills', 'strokes', 'effects']) if (n[key] !== undefined && !Array.isArray(n[key])) delete n[key];
  if (n.constraints && !n.constraints.horizontal) {
    // plugin API: { horizontal: 'MIN' | 'MAX' | 'STRETCH' | 'CENTER' | 'SCALE' }
    const map: Record<string, string> = { MIN: 'LEFT', MAX: 'RIGHT', STRETCH: 'LEFT_RIGHT', CENTER: 'CENTER', SCALE: 'SCALE' };
    n.constraints = { horizontal: map[n.constraints.h] ?? 'LEFT', vertical: map[n.constraints.v] ?? 'TOP' };
  } else if (n.constraints) {
    const h: Record<string, string> = { MIN: 'LEFT', MAX: 'RIGHT', STRETCH: 'LEFT_RIGHT' };
    const v: Record<string, string> = { MIN: 'TOP', MAX: 'BOTTOM', STRETCH: 'TOP_BOTTOM' };
    n.constraints = { horizontal: h[n.constraints.horizontal] ?? n.constraints.horizontal, vertical: v[n.constraints.vertical] ?? n.constraints.vertical };
  }

  if (n.type === 'TEXT' && !n.style) n.style = pluginTextStyle(n);
  // Some exports keep textAutoResize inside style rather than on the node.
  if (n.type === 'TEXT' && !n.textAutoResize && typeof n.style?.textAutoResize === 'string') n.textAutoResize = n.style.textAutoResize;
  if (n.type === 'TEXT' && typeof n.characters !== 'string') n.characters = String(n.characters ?? '');

  // Plugin API: children of a GROUP are positioned in the group's parent space.
  const box = n.absoluteBoundingBox;
  const childOriginX = n.type === 'GROUP' ? originX : box.x;
  const childOriginY = n.type === 'GROUP' ? originY : box.y;
  if (Array.isArray(n.children)) n.children = n.children.filter((c: any) => c && typeof c === 'object').map((c: any) => fixTree(c, childOriginX, childOriginY, n));
  else delete n.children;
  return n as FNode;
}

function pluginTextStyle(n: any): FTypeStyle {
  const size = typeof n.fontSize === 'number' ? n.fontSize : 14;
  const fontStyle: string = typeof n.fontName?.style === 'string' ? n.fontName.style : 'Regular';
  const lh = n.lineHeight;
  const ls = n.letterSpacing;
  return {
    fontFamily: n.fontName?.family ?? n.fontFamily ?? 'Roboto',
    fontWeight: typeof n.fontWeight === 'number' ? n.fontWeight : weightFromStyle(fontStyle),
    fontSize: size,
    italic: /italic/i.test(fontStyle),
    lineHeightPx: lh?.unit === 'PIXELS' ? lh.value : lh?.unit === 'PERCENT' ? (lh.value / 100) * size : undefined,
    lineHeightUnit: lh?.unit === 'AUTO' || !lh ? 'INTRINSIC_%' : 'PIXELS',
    letterSpacing: typeof ls === 'number' ? ls : ls?.unit === 'PERCENT' ? (ls.value / 100) * size : ls?.value ?? 0,
    textAlignHorizontal: n.textAlignHorizontal,
    textCase: typeof n.textCase === 'string' ? n.textCase : undefined,
    textDecoration: typeof n.textDecoration === 'string' ? n.textDecoration : undefined,
  };
}

function weightFromStyle(s: string): number {
  const t = s.toLowerCase().replace(/\s|-/g, '');
  if (t.includes('thin') || t.includes('hairline')) return 100;
  if (t.includes('extralight') || t.includes('ultralight')) return 200;
  if (t.includes('light')) return 300;
  if (t.includes('medium')) return 500;
  if (t.includes('semibold') || t.includes('demibold')) return 600;
  if (t.includes('extrabold') || t.includes('ultrabold')) return 800;
  if (t.includes('black') || t.includes('heavy')) return 900;
  if (t.includes('bold')) return 700;
  return 400;
}
