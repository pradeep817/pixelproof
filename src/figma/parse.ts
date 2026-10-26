import type {
  Box, ColorToken, Constraint, DesignDoc, IRNode, Layout, Paint, RGBA, Shadow, Sizing, Stroke, TextStyle, TextToken,
} from '../ir.js';
import type { FColor, FNode, FNodesResponse, FPaint, FStyleMeta, FComponentMeta } from './types.js';
import { camel, snake } from '../naming.js';
import { assetFormat, isAssetNode } from './assets.js';


interface Ctx {
  styles: Record<string, FStyleMeta>;
  components: Record<string, FComponentMeta>;
  colors: Map<string, ColorToken>;        // style id -> token
  textStyles: Map<string, TextToken>;     // style id -> token
  tokenNames: Set<string>;
  assets: DesignDoc['assets'];
  assetNames: Set<string>;
  fonts: Set<string>;
  keepSystemUi: boolean;
  omitted: string[];
}

export interface ParseOptions { keepSystemUi?: boolean }

/** Parse one node out of a GET /v1/files/:key/nodes response into the design tree. */
export function parseFigma(resp: FNodesResponse, nodeId: string, fileKey: string, options: ParseOptions = {}): DesignDoc {
  const entry = resp.nodes[nodeId] ?? Object.values(resp.nodes)[0];
  if (!entry) throw new Error(`Node ${nodeId} not found in Figma response (check the link and your access).`);
  const ctx: Ctx = {
    styles: entry.styles ?? {}, components: entry.components ?? {},
    colors: new Map(), textStyles: new Map(), tokenNames: new Set(),
    assets: [], assetNames: new Set(), fonts: new Set(),
    keepSystemUi: options.keepSystemUi ?? false, omitted: [],
  };
  const root = convert(entry.document, null, ctx);
  if (!root) throw new Error(`Node ${nodeId} is hidden or empty.`);
  root.width = 'fixed';
  root.height = 'fixed';
  return {
    fileKey, root,
    colors: [...ctx.colors.values()],
    textStyles: [...ctx.textStyles.values()],
    assets: ctx.assets,
    fonts: [...ctx.fonts].sort(),
    omitted: ctx.omitted,
  };
}

/** iOS / Android chrome from design kits: drawn by the phone, never by the app. */
export const SYSTEM_UI = /^(home ?indicator|status ?bar|notch|dynamic ?island|keyboard|navigation ?bar \(android\)|android ?navigation ?bar)\b/i;

function convert(n: FNode, parent: FNode | null, ctx: Ctx): IRNode | null {
  if (n.visible === false) return null;
  if (parent && !ctx.keepSystemUi && SYSTEM_UI.test(n.name.trim())) { ctx.omitted.push(n.name); return null; }
  const box = toBox(n);
  const warnings: string[] = [];

  // A straight LINE has a zero-height box; draw it as a bar in its stroke colour.
  if (n.type === 'LINE' && (box.height < 0.01 || box.width < 0.01)) {
    const s = visiblePaints(n.strokes).find(p => p.type === 'SOLID' && p.color);
    if (s?.color) {
      const weight = n.strokeWeight ?? 1;
      const horizontal = box.height < 0.01;
      const bar: FNode = {
        ...n, type: 'RECTANGLE', strokes: [], fills: [{ ...s }], styles: n.styles?.stroke ? { fill: n.styles.stroke } : undefined,
        absoluteBoundingBox: { x: box.x, y: box.y, width: horizontal ? box.width : weight, height: horizontal ? weight : box.height },
        layoutSizingVertical: horizontal ? 'FIXED' : n.layoutSizingVertical,
        layoutSizingHorizontal: horizontal ? n.layoutSizingHorizontal : 'FIXED',
      };
      return convert(bar, parent, ctx);
    }
  }

  const base: IRNode = {
    id: n.id, name: n.name, kind: 'frame', box,
    width: 'fixed', height: 'fixed',
    absolute: isAbsolute(n, parent),
    constraints: { h: constraint(n.constraints?.horizontal), v: constraint(n.constraints?.vertical) },
    layout: layoutOf(n),
    fills: [], radius: radii(n), shadows: [], opacity: n.opacity ?? 1,
    clip: n.clipsContent ?? false, rotation: n.rotation ?? 0,
    children: [], warnings,
  };
  [base.width, base.height] = sizing(n, parent);

  if (Math.abs(base.rotation) > 0.01) warnings.push(`rotated ${(base.rotation * 180 / Math.PI).toFixed(1)}°; rotation is not generated yet`);

  if (n.type === 'INSTANCE' && n.componentId) {
    const meta = ctx.components[n.componentId];
    base.component = { key: n.componentId, name: meta?.name ?? n.name, instance: true };
  }

  // Vector shapes, icons, logos and illustrations become one exported image.
  if (parent && isAssetNode(n)) { // the screen itself is never flattened to an image
    const format = assetFormat(n);
    base.kind = 'vector';
    base.asset = { format, file: registerAsset(ctx, n, format) };
    base.children = [];
    return base;
  }

  if (n.type === 'TEXT') {
    base.kind = 'text';
    const style = textStyle(n, ctx, warnings);
    const characters = applyCase(n.characters ?? '', n.style?.textCase);
    // Flutter adds letter spacing after the last glyph too, which shifts a centred single character.
    if ([...characters].length <= 1) style.letterSpacingPx = 0;
    // Text Figma wrapped onto several lines must keep its width, or Flutter lays it out on one line.
    const lh = style.lineHeightPx ?? style.fontSize * 1.25;
    if (base.width === 'hug' && box.height > lh * 1.5 && !characters.includes('\n')) base.width = 'fixed';
    base.text = { characters, style };
    return base;
  }

  if (n.type === 'ELLIPSE') base.kind = 'ellipse';

  base.fills = paints(n.fills, ctx, n, warnings, n.styles?.fill);
  base.stroke = stroke(n, ctx);
  base.shadows = shadows(n, warnings);
  const b = blurs(n);
  base.backgroundBlur = b.background;
  base.layerBlur = b.layer;

  for (const c of n.children ?? []) {
    const child = convert(c, n, ctx);
    if (child) base.children.push(child);
  }
  return base;
}

function toBox(n: FNode): Box {
  const b = n.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  return { x: b.x, y: b.y, width: round(b.width), height: round(b.height) };
}

function isAuto(n: FNode | null): boolean {
  return !!n && (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL');
}

function isAbsolute(n: FNode, parent: FNode | null): boolean {
  if (!parent) return false;
  if (!isAuto(parent)) return true;
  return n.layoutPositioning === 'ABSOLUTE';
}

function constraint(v?: string): Constraint {
  switch (v) {
    case 'RIGHT': case 'BOTTOM': return 'end';
    case 'LEFT_RIGHT': case 'TOP_BOTTOM': return 'both';
    case 'CENTER': return 'center';
    case 'SCALE': return 'scale';
    default: return 'start';
  }
}

function layoutOf(n: FNode): Layout {
  const mode = n.layoutMode === 'HORIZONTAL' ? 'row' : n.layoutMode === 'VERTICAL' ? 'column' : 'none';
  const main = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'spaceBetween' } as const;
  const cross = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'baseline' } as const;
  return {
    mode,
    gap: n.primaryAxisAlignItems === 'SPACE_BETWEEN' ? 0 : n.itemSpacing ?? 0,
    padding: { top: n.paddingTop ?? 0, right: n.paddingRight ?? 0, bottom: n.paddingBottom ?? 0, left: n.paddingLeft ?? 0 },
    mainAlign: main[n.primaryAxisAlignItems ?? 'MIN'],
    crossAlign: cross[n.counterAxisAlignItems ?? 'MIN'],
    wrap: n.layoutWrap === 'WRAP',
  };
}

/** Hug / fill / fixed for width and height, using the modern fields first, legacy fields second. */
function sizing(n: FNode, parent: FNode | null): [Sizing, Sizing] {
  const map = (s?: string): Sizing | undefined => s === 'FILL' ? 'fill' : s === 'HUG' ? 'hug' : s === 'FIXED' ? 'fixed' : undefined;
  let w = map(n.layoutSizingHorizontal);
  let h = map(n.layoutSizingVertical);
  if (w && h) return [w, h];

  if (n.type === 'TEXT') {
    if (n.textAutoResize === 'WIDTH_AND_HEIGHT') return [w ?? 'hug', h ?? 'hug'];
    if (n.textAutoResize === 'HEIGHT') return [w ?? 'fixed', h ?? 'hug'];
  }
  const parentRow = parent?.layoutMode === 'HORIZONTAL';
  const parentCol = parent?.layoutMode === 'VERTICAL';
  const grow = (n.layoutGrow ?? 0) > 0;
  const stretch = n.layoutAlign === 'STRETCH';
  if (parentRow) { w ??= grow ? 'fill' : undefined; h ??= stretch ? 'fill' : undefined; }
  if (parentCol) { h ??= grow ? 'fill' : undefined; w ??= stretch ? 'fill' : undefined; }
  if (isAuto(n)) {
    const mainHug = n.primaryAxisSizingMode === 'AUTO';
    const crossHug = n.counterAxisSizingMode === 'AUTO';
    if (n.layoutMode === 'HORIZONTAL') { w ??= mainHug ? 'hug' : undefined; h ??= crossHug ? 'hug' : undefined; }
    else { h ??= mainHug ? 'hug' : undefined; w ??= crossHug ? 'hug' : undefined; }
  }
  return [w ?? 'fixed', h ?? 'fixed'];
}

function radii(n: FNode): [number, number, number, number] {
  if (n.rectangleCornerRadii) return n.rectangleCornerRadii;
  const r = n.cornerRadius ?? 0;
  return [r, r, r, r];
}

function rgba(c: FColor, opacity = 1): RGBA {
  return { r: c.r, g: c.g, b: c.b, a: round4((c.a ?? 1) * opacity) };
}

function visiblePaints(list?: FPaint[]): FPaint[] {
  return (list ?? []).filter(p => p.visible !== false);
}

function paints(list: FPaint[] | undefined, ctx: Ctx, n: FNode, warnings: string[], styleId?: string): Paint[] {
  const out: Paint[] = [];
  const vis = visiblePaints(list);
  for (const p of vis) {
    const op = p.opacity ?? 1;
    if (p.type === 'SOLID' && p.color) {
      const color = rgba(p.color, op);
      const token = vis.length === 1 && styleId ? colorToken(ctx, styleId, color) : undefined;
      out.push({ kind: 'solid', color, token });
    } else if (p.type === 'GRADIENT_LINEAR' && p.gradientHandlePositions && p.gradientStops) {
      const [a, b] = p.gradientHandlePositions;
      // Some exports carry all-zero handles; fall back to Figma's default top-to-bottom direction.
      const degenerate = !a || !b || Math.hypot(b.x - a.x, b.y - a.y) < 1e-4;
      if (degenerate) warnings.push('gradient direction missing in the file; used top to bottom');
      out.push({ kind: 'linear', from: degenerate ? [0.5, 0] : [a.x, a.y], to: degenerate ? [0.5, 1] : [b.x, b.y], stops: stops(p, op) });
    } else if (p.type === 'GRADIENT_RADIAL' && p.gradientHandlePositions && p.gradientStops) {
      const [c, edge] = p.gradientHandlePositions;
      out.push({ kind: 'radial', center: [c.x, c.y], radius: Math.hypot(edge.x - c.x, edge.y - c.y), stops: stops(p, op) });
    } else if (p.type === 'IMAGE' && p.imageRef) {
      const file = registerAsset(ctx, n, 'png', p.imageRef);
      const fit = p.scaleMode === 'FIT' ? 'contain' : p.scaleMode === 'TILE' ? 'tile' : p.scaleMode === 'STRETCH' ? 'fill' : 'cover';
      out.push({ kind: 'image', ref: file, fit });
    } else {
      warnings.push(`${p.type.toLowerCase()} fill is not supported yet and was skipped`);
    }
  }
  return out;
}

function stops(p: FPaint, op: number) {
  // Flutter requires ascending stops; some exports list them in reverse.
  return (p.gradientStops ?? []).map(s => ({ color: rgba(s.color, op), position: round4(s.position) })).sort((x, y) => x.position - y.position);
}

function stroke(n: FNode, ctx: Ctx): Stroke | undefined {
  const p = visiblePaints(n.strokes).find(s => s.type === 'SOLID' && s.color);
  if (!p || !p.color || !(n.strokeWeight ?? 0)) return undefined;
  const color = rgba(p.color, p.opacity ?? 1);
  const align = n.strokeAlign === 'OUTSIDE' ? 'outside' : n.strokeAlign === 'CENTER' ? 'center' : 'inside';
  return { color, width: n.strokeWeight!, align, token: n.styles?.stroke ? colorToken(ctx, n.styles.stroke, color) : undefined };
}

function shadows(n: FNode, warnings: string[]): Shadow[] {
  const out: Shadow[] = [];
  for (const e of n.effects ?? []) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      out.push({
        inner: e.type === 'INNER_SHADOW', color: rgba(e.color ?? { r: 0, g: 0, b: 0, a: 0.25 }),
        x: e.offset?.x ?? 0, y: e.offset?.y ?? 0, blur: e.radius, spread: e.spread ?? 0,
      });
      if (e.type === 'INNER_SHADOW') warnings.push('inner shadow has no direct Flutter equivalent; skipped');
    }
  }
  return out.filter(s => !s.inner);
}

/** Figma blur radius maps to a Gaussian sigma of radius / 2 (as in Figma's own CSS export). */
function blurs(n: FNode): { background?: number; layer?: number } {
  const out: { background?: number; layer?: number } = {};
  for (const e of n.effects ?? []) {
    if (e.visible === false || !e.radius) continue;
    if (e.type === 'BACKGROUND_BLUR') out.background = e.radius / 2;
    if (e.type === 'LAYER_BLUR') out.layer = e.radius / 2;
  }
  return out;
}

function textStyle(n: FNode, ctx: Ctx, warnings: string[]): TextStyle {
  const s = n.style ?? { fontFamily: 'Roboto', fontWeight: 400, fontSize: 14 };
  ctx.fonts.add(`${s.fontFamily} ${s.fontWeight}${s.italic ? ' italic' : ''}`);
  const fills = paints(n.fills, ctx, n, warnings, n.styles?.fill);
  const solid = fills.find(f => f.kind === 'solid');
  if (fills.some(f => f.kind !== 'solid')) warnings.push('gradient or image text fill is not generated yet; used first solid color');
  const align = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', JUSTIFIED: 'justify' } as const;
  const style: TextStyle = {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    italic: !!s.italic,
    lineHeightPx: s.lineHeightUnit === 'INTRINSIC_%' ? undefined : s.lineHeightPx,
    letterSpacingPx: round4(s.letterSpacing ?? 0),
    color: solid?.kind === 'solid' ? solid.color : { r: 0, g: 0, b: 0, a: 1 },
    colorToken: solid?.kind === 'solid' ? solid.token : undefined,
    align: align[s.textAlignHorizontal ?? 'LEFT'],
    decoration: s.textDecoration === 'UNDERLINE' ? 'underline' : s.textDecoration === 'STRIKETHROUGH' ? 'lineThrough' : 'none',
  };
  const styleId = n.styles?.text;
  if (styleId && ctx.styles[styleId]) {
    let tok = ctx.textStyles.get(styleId);
    if (!tok) {
      tok = { name: uniqueToken(ctx, ctx.styles[styleId].name), style: { ...style, colorToken: undefined } };
      ctx.textStyles.set(styleId, tok);
    }
    style.token = tok.name;
  }
  return style;
}

function colorToken(ctx: Ctx, styleId: string, color: RGBA): string | undefined {
  const meta = ctx.styles[styleId];
  if (!meta) return undefined;
  let tok = ctx.colors.get(styleId);
  if (!tok) {
    tok = { name: uniqueToken(ctx, meta.name), color };
    ctx.colors.set(styleId, tok);
  }
  return tok.name;
}

function uniqueToken(ctx: Ctx, styleName: string): string {
  let name = camel(styleName) || 'token';
  if (/^[0-9]/.test(name)) name = `t${name}`;
  let out = name;
  for (let i = 2; ctx.tokenNames.has(out); i++) out = `${name}${i}`;
  ctx.tokenNames.add(out);
  return out;
}

function registerAsset(ctx: Ctx, n: FNode, format: 'svg' | 'png', imageRef?: string): string {
  const existing = imageRef && ctx.assets.find(a => a.imageRef === imageRef);
  if (existing) return existing.file;
  const dir = format === 'svg' ? 'assets/icons' : 'assets/images';
  const baseName = snake(n.name) || (format === 'svg' ? 'icon' : 'image');
  let file = `${dir}/${baseName}.${format}`;
  for (let i = 2; ctx.assetNames.has(file); i++) file = `${dir}/${baseName}_${i}.${format}`;
  ctx.assetNames.add(file);
  ctx.assets.push({ nodeId: n.id, file, format, imageRef });
  return file;
}


function applyCase(s: string, c?: string): string {
  if (c === 'UPPER') return s.toUpperCase();
  if (c === 'LOWER') return s.toLowerCase();
  if (c === 'TITLE') return s.replace(/\b\w/g, m => m.toUpperCase());
  return s;
}

const round = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
