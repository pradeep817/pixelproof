const words = (s: string): string[] =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());

export const camel = (s: string): string =>
  words(s).map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');

export const pascal = (s: string): string =>
  words(s).map(w => w[0].toUpperCase() + w.slice(1)).join('');

export const snake = (s: string): string => words(s).join('_');

const DART_RESERVED = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'do', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'for', 'if', 'in', 'is', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'var', 'void', 'while', 'with',
]);

export const dartIdent = (s: string, fallback = 'value'): string => {
  let id = camel(s) || fallback;
  if (/^[0-9]/.test(id)) id = `v${id}`;
  if (DART_RESERVED.has(id)) id = `${id}Value`;
  return id;
};

/** Dart single-quoted string literal. */
export const dartString = (s: string): string => {
  const base = s.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/\n/g, '\\n');
  if (s.includes("'") && !s.includes('"')) return `"${base}"`;
  return `'${base.replace(/'/g, "\\'")}'`;
};
