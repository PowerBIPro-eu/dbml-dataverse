import type { DiffChange, DiffResult, DiffSide, PropertyChange } from './diff.js';

// Markdown for release notes. Pure: DiffResult in, text out.

const OP_LABEL = { added: 'Added', removed: 'Removed', modified: 'Modified' } as const;

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const s = Array.isArray(value) ? value.join(', ') : String(value);
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

const code = (s: string | number | undefined) => `\`${s ?? ''}\``;
const named = (name: string | number | undefined, label: string | null | undefined) =>
  label ? `${code(name)} ${cell(label)}` : code(name);

function changesText(changes: Record<string, PropertyChange> | undefined): string {
  return Object.entries(changes ?? {})
    .map(([key, { from, to }]) => `${code(key)}: ${cell(from)} → ${cell(to)}`)
    .join('; ');
}

function renameText(c: DiffChange): string {
  return c.possibleRename ? ` (possibly renamed from ${code(c.possibleRename)})` : '';
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
}

function solutionsLine(from: DiffSide, to: DiffSide): string {
  if (!to.solutions.length && !from.solutions.length) return 'unknown (the models have no provenance)';
  const version = (v: string | null) => v ?? 'unknown version';
  const keyOf = (s: DiffSide['solutions'][number]) => s.uniqueName ?? s.name;
  const before = new Map(from.solutions.map((s) => [keyOf(s), s]));
  const after = new Set(to.solutions.map(keyOf));
  const parts = to.solutions.map((s) => {
    const old = before.get(keyOf(s));
    if (!old) return `${s.name} ${version(s.version)} (new)`;
    return old.version === s.version ? `${s.name} ${version(s.version)}` : `${s.name} ${version(old.version)} → ${version(s.version)}`;
  });
  for (const s of from.solutions) if (!after.has(keyOf(s))) parts.push(`${s.name} ${version(s.version)} (removed)`);
  return parts.join(' · ');
}

/** Added/removed: what the item is (`describe` gets its properties); modified: what changed. */
function details(c: DiffChange, describe: (item: Record<string, unknown>) => string): string {
  if (c.op === 'modified') return changesText(c.changes);
  return describe(c.after ?? c.before ?? {}) + renameText(c);
}

export function renderMarkdown(result: DiffResult): string {
  const lines = [
    `### Data model changes (${result.from.ref} → ${result.to.ref})`,
    '',
    `**Solutions:** ${solutionsLine(result.from, result.to)}`,
    '',
  ];
  const of = (...kinds: DiffChange['kind'][]) => result.changes.filter((c) => kinds.includes(c.kind));

  if (!result.changes.length) lines.push('No data model changes.', '');

  const tables = of('table');
  if (tables.length) {
    lines.push('#### Tables', '', ...table(['Change', 'Table', 'Details'], tables.map((c) => [
      OP_LABEL[c.op], named(c.table, c.label),
      c.op === 'modified' ? changesText(c.changes) : `${c.columns?.length ?? 0} columns${renameText(c)}`,
    ])), '');
  }

  const columns = of('column');
  if (columns.length) {
    lines.push('#### Columns', '', ...table(['Change', 'Table', 'Column', 'Details'], columns.map((c) => [
      OP_LABEL[c.op], code(c.table), named(c.column, c.label),
      details(c, (item) => cell(item.type)),
    ])), '');
  }

  const choices = of('optionSet', 'option');
  if (choices.length) {
    lines.push('#### Choices and status reasons', '', ...table(['Change', 'Choice', 'Value', 'Details'], choices.map((c) => {
      const choice = `${code(c.optionSet)}${c.usedBy?.length ? ` (${c.usedBy.join(', ')})` : ''}`;
      if (c.kind === 'optionSet') {
        return [OP_LABEL[c.op], choice, '', c.op === 'modified' ? changesText(c.changes) : `${c.options?.length ?? 0} values`];
      }
      const state = (item: Record<string, unknown>) => (typeof item.state === 'number' ? `state ${item.state}` : '');
      return [OP_LABEL[c.op], choice, `${c.value} ${cell(c.label)}`, details(c, state)];
    })), '');
  }

  const relationships = of('relationship');
  if (relationships.length) {
    lines.push('#### Relationships', '', ...table(['Change', 'Relationship', 'Details'], relationships.map((c) => [
      OP_LABEL[c.op], code(c.relationship),
      c.op === 'modified' ? changesText(c.changes) : cell((c.after ?? c.before)?.endpoints),
    ])), '');
  }

  const keys = of('key');
  if (keys.length) {
    lines.push('#### Keys', '', ...table(['Change', 'Table', 'Key', 'Details'], keys.map((c) => [
      OP_LABEL[c.op], code(c.table), code(c.key),
      c.op === 'modified' ? changesText(c.changes) : cell((c.after ?? c.before)?.columns),
    ])), '');
  }

  for (const note of result.notes) lines.push(`> ${note}`, '>');
  if (result.notes.length) lines.pop();

  return lines.join('\n').replace(/\n+$/, '') + '\n';
}
