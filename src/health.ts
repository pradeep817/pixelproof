import type { FNode } from './figma/types.js';
import { isAssetNode } from './figma/assets.js';
import { SYSTEM_UI } from './figma/parse.js';

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  severity: Severity;
  rule: string;
  nodeId: string;
  nodeName: string;
  message: string;
  fix: string;
}

export interface HealthReport { score: number; issues: Issue[] }

/** The names Figma assigns automatically, per layer type. A rectangle named "Line" was named on purpose. */
const DEFAULT_NAMES: Partial<Record<FNode['type'], string>> = {
  FRAME: 'Frame', GROUP: 'Group', RECTANGLE: 'Rectangle', ELLIPSE: 'Ellipse', VECTOR: 'Vector', LINE: 'Line',
  BOOLEAN_OPERATION: 'Union|Subtract|Intersect|Exclude', STAR: 'Star', REGULAR_POLYGON: 'Polygon', COMPONENT: 'Component', SECTION: 'Section',
};
const isDefaultName = (n: FNode) => {
  const d = DEFAULT_NAMES[n.type];
  return !!d && new RegExp(`^(${d})( \\d+)?$`).test(n.name);
};
const PENALTY: Record<Severity, number> = { error: 10, warn: 3, info: 1 };
const RULE_CAP = 12;

/**
 * Pre-flight check run before conversion. File quality is the ceiling for every
 * design-to-code tool, so we tell the designer exactly what to fix.
 */
export function checkHealth(root: FNode): HealthReport {
  const issues: Issue[] = [];
  const add = (n: FNode, severity: Severity, rule: string, message: string, fix: string) =>
    issues.push({ severity, rule, nodeId: n.id, nodeName: n.name, message, fix });

  const walk = (n: FNode, parent: FNode | null) => {
    if (n.visible === false) return;
    // Icons, logos and illustrations are exported as one image: their internals don't matter.
    if (parent && isAssetNode(n)) return;
    if (parent && SYSTEM_UI.test(n.name.trim())) return; // status bar / home indicator: left out of the code
    const kids = (n.children ?? []).filter(c => c.visible !== false);
    const container = ['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP'].includes(n.type);
    const auto = n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL';

    if (container && kids.length >= 2 && !auto && !allVectors(kids)) {
      add(n, 'warn', 'no-auto-layout', `${kids.length} children are positioned by hand, so the layout cannot adapt to screen sizes.`,
        'Select the layer and press Shift+A to apply auto layout.');
      const overlaps = countOverlaps(kids);
      if (overlaps > 0) add(n, 'info', 'overlap', `${overlaps} overlapping sibling pair(s); these become a Stack.`,
        'Keep overlaps only for intentional layering (badges, backgrounds).');
    }
    if (n.type === 'GROUP' && kids.length >= 2) {
      add(n, 'info', 'group', 'Groups carry no layout rules.', 'Convert the group to a frame with auto layout (Ctrl+Alt+G, then Shift+A).');
    }
    if (isDefaultName(n) && !isVectorOnly(n)) {
      add(n, 'warn', 'default-name', `"${n.name}" is a default name, so the generated widget gets a generic name.`,
        'Rename it after its purpose, e.g. "Login Button" or "Header".');
    }
    for (const p of n.fills ?? []) {
      if (p.visible !== false && p.type === 'SOLID' && (p.opacity ?? 1) < 1 && (p.opacity ?? 1) > 0) {
        add(n, 'info', 'translucent-fill', 'Translucent fill; colours over other layers may not match exactly.', 'Use an opaque colour unless the see-through effect is intended.');
        break;
      }
      if (p.visible !== false && p.type === 'SOLID' && !n.styles?.fill && n.type !== 'TEXT' && container) {
        // unnamed colour on a container: suggest a colour style once per node
        add(n, 'info', 'raw-color', 'Fill colour is not a colour style or variable, so it becomes a hard-coded value.', 'Apply a colour style so the code uses a theme token.');
        break;
      }
    }
    if (n.type === 'TEXT' && !n.styles?.text) {
      add(n, 'info', 'raw-text-style', 'Text has no text style, so it becomes a one-off TextStyle.', 'Apply a text style from your library.');
    }
    if (n.type === 'TEXT' && n.textAutoResize === 'NONE') {
      add(n, 'warn', 'fixed-text-box', 'Fixed-size text box may clip longer strings or translations.', 'Set the text to "Auto height" or "Auto width".');
    }
    if (Math.abs(n.rotation ?? 0) > 0.01) {
      add(n, 'warn', 'rotation', 'Rotated layers are not generated yet.', 'Remove the rotation, or flatten and export it as an image.');
    }
    if (parent && auto && n.layoutPositioning !== 'ABSOLUTE' && n.type === 'INSTANCE' && !n.componentId) {
      add(n, 'error', 'missing-component', 'Instance has no main component (detached or from an unpublished library).', 'Publish the library or relink the instance.');
    }

    checkRepeats(n, kids, add);
    kids.forEach(k => walk(k, n));
  };
  walk(root, null);

  // One problem repeated 30 times is still one problem to fix: cap the penalty per rule.
  const perRule = new Map<string, number>();
  for (const i of issues) perRule.set(i.rule, (perRule.get(i.rule) ?? 0) + PENALTY[i.severity]);
  const penalty = [...perRule.values()].reduce((s, v) => s + Math.min(v, RULE_CAP), 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

/** Three or more structurally identical siblings that are not instances should probably be a component. */
function checkRepeats(n: FNode, kids: FNode[], add: (n: FNode, s: Severity, r: string, m: string, f: string) => void) {
  const groups = new Map<string, FNode[]>();
  for (const k of kids) {
    if (k.type === 'INSTANCE' || !k.children?.length) continue;
    const h = shape(k);
    groups.set(h, [...(groups.get(h) ?? []), k]);
  }
  for (const g of groups.values()) {
    if (g.length >= 3) add(n, 'info', 'repeat-not-component', `${g.length} identical layers ("${g[0].name}") are not a component.`,
      'Turn the first one into a component and replace the others with instances.');
  }
}

const shape = (n: FNode): string => `${n.type}[${(n.children ?? []).map(shape).join(',')}]`;
const VEC = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE']);
const allVectors = (kids: FNode[]): boolean => kids.every(k => VEC.has(k.type) || (k.children?.length ? allVectors(k.children) : false));
const isVectorOnly = (n: FNode) => VEC.has(n.type) || (!!n.children?.length && allVectors(n.children));

function countOverlaps(kids: FNode[]): number {
  let count = 0;
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const a = kids[i].absoluteBoundingBox, b = kids[j].absoluteBoundingBox;
    if (a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) count++;
  }
  return count;
}

export function formatReport(r: HealthReport): string {
  const icon: Record<Severity, string> = { error: '✖', warn: '▲', info: '•' };
  const lines = [`Design health: ${r.score}/100  (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`];
  for (const sev of ['error', 'warn', 'info'] as Severity[]) {
    // Group by rule: show up to 3 examples, then a count, so 30 repeats read as one line.
    const byRule = new Map<string, Issue[]>();
    for (const i of r.issues.filter(x => x.severity === sev)) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i]);
    for (const [rule, list] of byRule) {
      if (list.length <= 3) {
        for (const i of list) lines.push(`  ${icon[sev]} [${rule}] ${i.nodeName}: ${i.message}\n      fix: ${i.fix}`);
      } else {
        const names = [...new Set(list.map(i => i.nodeName))];
        const shown = names.slice(0, 3).map(n => `"${n}"`).join(', ');
        const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
        lines.push(`  ${icon[sev]} [${rule}] ${list.length} layers (${shown}${more}): ${list[0].message}\n      fix: ${list[0].fix}`);
      }
    }
  }
  return lines.join('\n');
}
