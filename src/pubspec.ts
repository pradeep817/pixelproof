/**
 * Minimal, comment-preserving edits to a Flutter pubspec.yaml. Only touches the
 * top-level `flutter:` section's `assets:` list, so a user's formatting stays intact.
 */

const TOP_FLUTTER = /^flutter:\s*(#.*)?$/;
const isContent = (l: string) => l.trim() !== '' && !l.trim().startsWith('#');
const indentOf = (l: string) => l.length - l.trimStart().length;
const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');

export function packageName(yaml: string): string | undefined {
  return yaml.match(/^name:\s*['"]?([A-Za-z0-9_]+)/m)?.[1];
}

export function hasDependency(yaml: string, name: string): boolean {
  return new RegExp(`^\\s+${name}:`, 'm').test(yaml);
}

/** Adds asset folders under flutter > assets. Returns the new text and which entries were added. */
export function addAssets(yaml: string, dirs: string[]): { yaml: string; added: string[] } {
  if (!dirs.length) return { yaml, added: [] };
  const eol = yaml.includes('\r\n') ? '\r\n' : '\n';
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex(l => TOP_FLUTTER.test(l));

  if (start === -1) {
    const block = ['flutter:', '  uses-material-design: true', '  assets:', ...dirs.map(d => `    - ${d}`)];
    const body = yaml.replace(/\s*$/, '');
    return { yaml: `${body}${eol}${eol}${block.join(eol)}${eol}`, added: [...dirs] };
  }

  // The section runs until the next top-level key.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (isContent(lines[i]) && indentOf(lines[i]) === 0) { end = i; break; }

  const assetsAt = lines.findIndex((l, i) => i > start && i < end && /^\s+assets:\s*(#.*)?$/.test(l) && isContent(l));
  if (assetsAt !== -1) {
    const base = indentOf(lines[assetsAt]);
    const existing = new Set<string>();
    let last = assetsAt;
    let itemIndent = base + 2;
    for (let i = assetsAt + 1; i < end; i++) {
      const l = lines[i];
      if (!isContent(l)) continue;
      if (indentOf(l) <= base) break;
      if (l.trim().startsWith('-')) { existing.add(unquote(l.trim().slice(1))); itemIndent = indentOf(l); }
      last = i;
    }
    const added = dirs.filter(d => !existing.has(d));
    lines.splice(last + 1, 0, ...added.map(d => `${' '.repeat(itemIndent)}- ${d}`));
    return { yaml: lines.join(eol), added };
  }

  // No assets list yet: add one after the section's last real line, at the section's indent.
  let childIndent = 2, lastContent = start;
  for (let i = start + 1; i < end; i++) if (isContent(lines[i])) { if (lastContent === start) childIndent = indentOf(lines[i]); lastContent = i; }
  const pad = ' '.repeat(childIndent);
  lines.splice(lastContent + 1, 0, `${pad}assets:`, ...dirs.map(d => `${pad}  - ${d}`));
  return { yaml: lines.join(eol), added: [...dirs] };
}
