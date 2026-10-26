import type { FNode, FPaint } from './types.js';

/**
 * Draws an icon / logo node to SVG from the vector geometry included in Figma JSON
 * (`fillGeometry`, `strokeGeometry`, `relativeTransform`), so icons work without an
 * API call. Handles nested groups, masks (as clip paths), strokes, solid and gradient
 * fills, opacity and clipped frames. Returns null when the file carries no geometry.
 */

type M = [number, number, number, number, number, number]; // SVG matrix(a b c d e f)
const I: M = [1, 0, 0, 1, 0, 0];

const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];

interface Geo { path: string; windingRule?: 'NONZERO' | 'EVENODD' | 'NONE' }
type Node = FNode & {
  relativeTransform?: [[number, number, number], [number, number, number]];
  fillGeometry?: Geo[]; strokeGeometry?: Geo[]; size?: { x: number; y: number };
};

export function renderSvg(rootIn: FNode): string | null {
  const root = rootIn as Node;
  const box = root.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const defs: string[] = [];
  let ids = 0;
  let drew = false;
  const id = (p: string) => `${p}${++ids}`;

  const local = (n: Node, parent: Node): M => {
    const t = n.relativeTransform;
    if (t) return [t[0][0], t[1][0], t[0][1], t[1][1], t[0][2], t[1][2]];
    const a = n.absoluteBoundingBox, b = parent.absoluteBoundingBox;
    return a && b ? [1, 0, 0, 1, a.x - b.x, a.y - b.y] : I;
  };
  const size = (n: Node) => n.size ?? { x: n.absoluteBoundingBox?.width ?? 0, y: n.absoluteBoundingBox?.height ?? 0 };
  const mat = (m: M) => (m.every((v, i) => Math.abs(v - I[i]) < 1e-9) ? '' : ` transform="matrix(${m.map(r).join(' ')})"`);

  const paint = (paints: FPaint[] | undefined, n: Node): { attr: string } | null => {
    const p = (paints ?? []).filter(x => x.visible !== false).at(-1);
    if (!p) return null;
    const op = p.opacity ?? 1;
    if (p.type === 'SOLID' && p.color) return { attr: color(p.color, op) };
    if ((p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL') && p.gradientStops?.length) {
      const { x: w, y: h } = size(n);
      const [a, b] = p.gradientHandlePositions ?? [];
      const ok = a && b && Math.hypot(b.x - a.x, b.y - a.y) > 1e-4;
      const s0 = ok ? a : { x: 0.5, y: 0 }, s1 = ok ? b : { x: 0.5, y: 1 };
      const gid = id('g');
      const stops = [...p.gradientStops].sort((x, y) => x.position - y.position)
        .map(s => `<stop offset="${r(s.position)}" stop-color="${hex(s.color)}" stop-opacity="${r((s.color.a ?? 1) * op)}"/>`).join('');
      defs.push(p.type === 'GRADIENT_LINEAR'
        ? `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${r(s0.x * w)}" y1="${r(s0.y * h)}" x2="${r(s1.x * w)}" y2="${r(s1.y * h)}">${stops}</linearGradient>`
        : `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${r(s0.x * w)}" cy="${r(s0.y * h)}" r="${r(Math.hypot((s1.x - s0.x) * w, (s1.y - s0.y) * h))}">${stops}</radialGradient>`);
      return { attr: `fill="url(#${gid})"` };
    }
    if (p.gradientStops?.length) return { attr: color(p.gradientStops[0].color, op) };
    return null; // image fills cannot be drawn here
  };

  const shapes = (n: Node, m: M): string => {
    const out: string[] = [];
    const fill = paint(n.fills, n);
    if (fill && n.fillGeometry?.length) {
      for (const g of n.fillGeometry) out.push(`<path d="${g.path}"${rule(g)} ${fill.attr}${mat(m)}/>`);
    } else if (fill && !n.children?.length && ['RECTANGLE', 'FRAME', 'ELLIPSE'].includes(n.type)) {
      const { x: w, y: h } = size(n);
      out.push(n.type === 'ELLIPSE'
        ? `<ellipse cx="${r(w / 2)}" cy="${r(h / 2)}" rx="${r(w / 2)}" ry="${r(h / 2)}" ${fill.attr}${mat(m)}/>`
        : `<rect width="${r(w)}" height="${r(h)}"${n.cornerRadius ? ` rx="${r(n.cornerRadius)}"` : ''} ${fill.attr}${mat(m)}/>`);
    } else if (fill && n.children?.length && n.type === 'FRAME') {
      const { x: w, y: h } = size(n);
      out.push(`<rect width="${r(w)}" height="${r(h)}"${n.cornerRadius ? ` rx="${r(n.cornerRadius)}"` : ''} ${fill.attr}${mat(m)}/>`);
    }
    const stroke = paint(n.strokes, n);
    if (stroke && n.strokeGeometry?.length && (n.strokeWeight ?? 1) > 0) {
      for (const g of n.strokeGeometry) out.push(`<path d="${g.path}"${rule(g)} ${stroke.attr}${mat(m)}/>`);
    }
    if (out.length) drew = true;
    return out.join('');
  };

  const clipFrom = (n: Node, m: M): string => {
    const cid = id('c');
    const geo = n.fillGeometry?.length
      ? n.fillGeometry.map(g => `<path d="${g.path}"${rule(g)}${mat(m)}/>`).join('')
      : `<rect width="${r(size(n).x)}" height="${r(size(n).y)}"${n.cornerRadius ? ` rx="${r(n.cornerRadius)}"` : ''}${mat(m)}/>`;
    defs.push(`<clipPath id="${cid}">${geo}</clipPath>`);
    return cid;
  };

  const node = (n: Node, m: M): string => {
    if (n.visible === false) return '';
    let body = shapes(n, m);
    // A boolean operation's fillGeometry already is the combined result.
    if (n.children?.length && !(n.type === 'BOOLEAN_OPERATION' && n.fillGeometry?.length)) {
      let kids = children(n, m);
      if (n.clipsContent && n.type !== 'GROUP') kids = `<g clip-path="url(#${clipFrom({ ...n, fillGeometry: undefined } as Node, m)})">${kids}</g>`;
      body += kids;
    }
    const op = n.opacity ?? 1;
    return op < 1 && body ? `<g opacity="${r(op)}">${body}</g>` : body;
  };

  /** Siblings after a mask layer are clipped by it, until the parent ends. */
  const children = (n: Node, m: M): string => {
    let out = '';
    let open = 0;
    for (const raw of n.children ?? []) {
      const c = raw as Node;
      if (c.visible === false) continue;
      const cm = mul(m, local(c, n));
      if (c.isMask) { out += `<g clip-path="url(#${clipFrom(c, cm)})">`; open++; continue; }
      out += node(c, cm);
    }
    return out + '</g>'.repeat(open);
  };

  const body = shapes({ ...root, children: undefined } as Node, I) + children(root, I);
  if (!drew) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r(box.width)}" height="${r(box.height)}" viewBox="0 0 ${r(box.width)} ${r(box.height)}" fill="none">`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body + '</svg>\n';
}

const r = (v: number) => `${Math.round(v * 1000) / 1000}`;
const rule = (g: Geo) => (g.windingRule === 'EVENODD' ? ' fill-rule="evenodd" clip-rule="evenodd"' : '');
const hex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const color = (c: { r: number; g: number; b: number; a?: number }, op: number) => {
  const a = (c.a ?? 1) * op;
  return `fill="${hex(c)}"${a < 1 ? ` fill-opacity="${r(a)}"` : ''}`;
};
