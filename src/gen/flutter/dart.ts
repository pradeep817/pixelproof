// Tiny Dart expression builder + formatter (trailing-comma style, like `dart format`).

export type Expr = string | Call | ListExpr;
export interface Arg { key?: string; value: Expr }
export interface Call { kind: 'call'; name: string; args: Arg[]; isConst?: boolean }
export interface ListExpr { kind: 'list'; items: Expr[]; isConst?: boolean }

export const call = (name: string, named: Record<string, Expr | undefined> = {}, positional: Expr[] = [], isConst = false): Call => ({
  kind: 'call', name, isConst,
  args: [
    ...positional.map(value => ({ value })),
    ...Object.entries(named).filter(([, v]) => v !== undefined).map(([key, value]) => ({ key, value: value as Expr })),
  ],
});

export const list = (items: Expr[], isConst = false): ListExpr => ({ kind: 'list', items, isConst });

const INLINE_MAX = 72;

export function format(e: Expr, indent = 0): string {
  if (typeof e === 'string') return e;
  const inline = tryInline(e);
  if (inline !== null && inline.length + indent <= INLINE_MAX + 8) return inline;
  const pad = '  '.repeat(indent + 1);
  const end = '  '.repeat(indent);
  if (e.kind === 'list') {
    if (!e.items.length) return `${e.isConst ? 'const ' : ''}[]`;
    return `${e.isConst ? 'const ' : ''}[\n${e.items.map(i => `${pad}${format(i, indent + 1)},`).join('\n')}\n${end}]`;
  }
  if (!e.args.length) return `${e.isConst ? 'const ' : ''}${e.name}()`;
  const body = e.args.map(a => `${pad}${a.key ? `${a.key}: ` : ''}${format(a.value, indent + 1)},`).join('\n');
  return `${e.isConst ? 'const ' : ''}${e.name}(\n${body}\n${end})`;
}

function tryInline(e: Expr): string | null {
  if (typeof e === 'string') return e.includes('\n') ? null : e;
  if (e.kind === 'list') {
    const parts = e.items.map(tryInline);
    if (parts.some(p => p === null) || e.items.some(i => typeof i !== 'string' && i.kind === 'call' && hasChild(i))) return null;
    const s = `${e.isConst ? 'const ' : ''}[${parts.join(', ')}]`;
    return s.length <= INLINE_MAX ? s : null;
  }
  if (hasChild(e)) return null;
  const parts = e.args.map(a => {
    const v = tryInline(a.value);
    return v === null ? null : `${a.key ? `${a.key}: ` : ''}${v}`;
  });
  if (parts.some(p => p === null)) return null;
  const s = `${e.isConst ? 'const ' : ''}${e.name}(${parts.join(', ')})`;
  return s.length <= INLINE_MAX ? s : null;
}

/** Widgets with children are always broken over lines, for readable diffs. */
const hasChild = (c: Call) => c.args.some(a => a.key === 'child' || a.key === 'children');

export const num = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? `${r}` : `${r}`;
};

/** Dart double literal (always with a decimal point where Dart needs a double). */
export const dbl = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? `${r}.0` : `${r}`;
};
