import type { FNode } from './types.js';

/** Shape layers that only make sense as part of a drawing. */
export const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE']);
const SHAPE_TYPES = new Set([...VECTOR_TYPES, 'ELLIPSE', 'RECTANGLE']);
const CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE']);
const ICON_NAME = /icon|logo|emblem|illustration|graphic|glyph|symbol|flag|badge|brand|mark|artwork|vector/i;

/**
 * True when a node should be exported as one image (SVG, or PNG if it holds bitmaps)
 * instead of being rebuilt as widgets: icons, logos, illustrations. Exported icons are
 * often groups of clip paths and masks, so masks and rectangles count as drawing parts.
 */
export function isAssetNode(n: FNode): boolean {
  if (VECTOR_TYPES.has(n.type)) return true;
  if (!CONTAINERS.has(n.type)) return false;
  if (n.exportSettings?.some(e => e.format === 'SVG' || e.format === 'PNG')) return true;

  const leaves: FNode[] = [];
  let hasMask = false, hasDrawing = false, hasText = false;
  const walk = (x: FNode) => {
    if (x.visible === false) return;
    if (x.isMask) hasMask = true;
    if (x.type === 'TEXT') hasText = true;
    if (VECTOR_TYPES.has(x.type)) hasDrawing = true;
    if (x.children?.length) x.children.forEach(walk);
    else if (x !== n) leaves.push(x);
  };
  walk(n);
  if (hasText || !leaves.length) return false;
  if (!leaves.every(l => SHAPE_TYPES.has(l.type))) return false;
  if (!hasDrawing && !hasMask) return false; // e.g. a progress bar made of two rectangles stays widgets

  const b = n.absoluteBoundingBox;
  const small = !!b && b.width <= 64 && b.height <= 64;
  return small || hasMask || ICON_NAME.test(n.name) || n.type === 'GROUP';
}

/** Bitmaps inside a drawing cannot go into an SVG reliably; export those as PNG. */
export function assetFormat(n: FNode): 'svg' | 'png' {
  let bitmap = false;
  const walk = (x: FNode) => {
    if (x.fills?.some(f => f.type === 'IMAGE' && f.visible !== false)) bitmap = true;
    x.children?.forEach(walk);
  };
  walk(n);
  return bitmap ? 'png' : 'svg';
}
