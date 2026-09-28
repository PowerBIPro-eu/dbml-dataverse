import { compareStrings } from '../util.js';

// Semantic diff of two model.json files (schema 1 from dv-tools 1.0.x, or schema 2). Pure: no I/O.

export const DIFF_SCHEMA = 1;
export const DIFF_KINDS = ['solution', 'table', 'column', 'optionSet', 'option', 'relationship', 'key'] as const;
export type DiffKind = (typeof DIFF_KINDS)[number];
export type DiffOp = 'added' | 'removed' | 'modified';

type Json = Record<string, any>;
export type Props = Record<string, unknown>;

export interface PropertyChange {
  from: unknown;
  to: unknown;
}

export interface DiffChange {
  kind: DiffKind;
  op: DiffOp;
  solution?: string;
  table?: string;
  column?: string;
  optionSet?: string;
  value?: number;
  relationship?: string;
  key?: string;
  label?: string | null;          // display name or option label
  usedBy?: string[];              // choices: the table.column that use them
  before?: Props;                 // removed
  after?: Props;                  // added
  changes?: Record<string, PropertyChange>;   // modified
  columns?: Props[];              // added/removed table: its columns
  keys?: Props[];                 // added/removed table: its alternate keys
  options?: Props[];              // added/removed choice: its values
  possibleRename?: string;        // added item: a removed item of the same kind and scope shares its display name
}

export interface DiffSide {
  ref: string;
  modelSchema: number | null;     // null: there was no model (counts as empty)
  solutions: Array<{ order: number; name: string; uniqueName: string | null; version: string | null }>;
}

export interface DiffResult {
  diffSchema: typeof DIFF_SCHEMA;
  from: DiffSide;
  to: DiffSide;
  summary: {
    total: number;
    added: number;
    removed: number;
    modified: number;
    byKind: Record<DiffKind, Record<DiffOp, number>>;
  };
  changes: DiffChange[];
  notes: string[];
}

// ── Normalized view of a model ─────────────────────────────────────────────

interface TableView {
  name: string;
  props: Props;
  columns: Map<string, Props>;
  keys: Map<string, Props>;
}

interface ChoiceView {
  props: Props;
  options: Map<number, Props>;
}

interface ModelView {
  schema: number | null;
  solutions: Map<string, Props>;
  tables: Map<string, TableView>;
  choices: Map<string, ChoiceView>;
  relationships: Map<string, Props>;
  usedBy: Map<string, string[]>;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const flag = (v: unknown): boolean => v === true;
const list = (v: unknown): Json[] => (Array.isArray(v) ? v : []);

function columnProps(f: Json, schema2: boolean): Props {
  const props: Props = {
    type: text(f.type?.type_name ?? f.type),
    displayName: text(f.displayName),
    required: text(f.required),
    pk: flag(f.pk),
    sourceType: text(f.sourceType),
    format: text(f.format),
    autoNumber: text(f.autoNumber),
    optionSet: text(f.optionSetName),
    targets: text(f.targets),
    sourceSolution: text(f.sourceSolution),
  };
  // schema 2 has the full description; schema 1 only the short note
  if (!schema2) return { ...props, note: text(f.note?.value) };
  return {
    ...props,
    description: text(f.description),
    isCustom: flag(f.isCustom),
    isModified: flag(f.isModified),
    modifications: list(f.modifications),
  };
}

function tableProps(t: Json, schema2: boolean): Props {
  const props: Props = {
    name: t.name,
    displayName: text(t.displayName),
    description: text(t.description),
    ownership: text(t.ownership),
    isActivity: flag(t.isActivity),
    isActivityParty: flag(t.isActivityParty),
    isAuditEnabled: flag(t.isAuditEnabled),
    sourceSolution: text(t.sourceSolution),
  };
  return schema2 ? { ...props, isCustom: flag(t.isCustom), isPartial: flag(t.isPartial) } : props;
}

function endpoints(ref: Json): string {
  const [a, b] = list(ref.endpoints);
  if (!a || !b) return '';
  const side = (e: Json) => `${e.tableName}.${list(e.fieldNames).join(',')}`;
  const op = a.relation === '1' && b.relation === '*' ? '<'
    : a.relation === '*' && b.relation === '1' ? '>'
    : a.relation === '*' && b.relation === '*' ? '<>' : '-';
  return `${side(a)} ${op} ${side(b)}`;
}

const REF_PROPS = [
  'onDelete', 'cascadeAssign', 'cascadeArchive', 'cascadeReparent', 'cascadeShare', 'cascadeUnshare', 'cascadeRollupView',
  'intersectEntity', 'navMany', 'navOne', 'navPaneDisplay', 'navPaneArea', 'sourceSolution',
];

function relationshipProps(r: Json): Props {
  const props: Props = { endpoints: endpoints(r) };
  for (const key of REF_PROPS) props[key] = text(r[key]);
  return { ...props, navPaneOrder: num(r.navPaneOrder), isHierarchical: flag(r.isHierarchical) };
}

const CHOICE_COLLECTIONS: Array<[string, string]> = [
  ['optionSets', 'choice'], ['stateOptionSets', 'state'], ['statusOptionSets', 'status'], ['bitOptionSets', 'yesNo'],
];

function optionProps(type: string, v: Json, schema2: boolean): Props {
  const props: Props = { label: text(v.label) };
  if (type === 'choice') props.color = text(v.color);
  if (type === 'state') Object.assign(props, { invariantName: text(v.invariantName), defaultStatus: num(v.defaultStatus) });
  if (type === 'status') Object.assign(props, { state: num(v.state), color: text(v.color), ...(schema2 ? { isCustom: flag(v.isCustom) } : {}) });
  return props;
}

function viewOf(model: Json | null): ModelView {
  const schema = model ? (typeof model.modelSchema === 'number' ? model.modelSchema : 1) : null;
  const schema2 = (schema ?? 2) >= 2;
  const view: ModelView = { schema, solutions: new Map(), tables: new Map(), choices: new Map(), relationships: new Map(), usedBy: new Map() };
  if (!model) return view;

  for (const layer of list(model.provenance?.layers)) {
    view.solutions.set(layer.uniqueName ?? layer.name, {
      name: text(layer.name), displayName: text(layer.displayName), version: text(layer.version), order: num(layer.order),
    });
  }

  for (const t of list(model.tables)) {
    const columns = new Map<string, Props>();
    for (const f of list(t.fields)) {
      columns.set(f.name, columnProps(f, schema2));
      if (f.optionSetName) view.usedBy.set(f.optionSetName, [...(view.usedBy.get(f.optionSetName) ?? []), `${t.name}.${f.name}`]);
    }
    const keys = new Map<string, Props>();
    for (const index of list(t.indexes)) {
      if (index.name) keys.set(index.name, { columns: list(index.columns).map((c) => c.value).join(', '), unique: flag(index.unique) });
    }
    view.tables.set(t.logicalName ?? String(t.name).toLowerCase(), { name: t.name, props: tableProps(t, schema2), columns, keys });
  }

  for (const [collection, type] of CHOICE_COLLECTIONS) {
    for (const os of list(model[collection])) {
      const options = new Map<number, Props>();
      if (type === 'yesNo') {
        options.set(1, { label: text(os.trueLabel) });
        options.set(0, { label: text(os.falseLabel) });
      } else {
        for (const v of list(os.values)) if (typeof v.value === 'number') options.set(v.value, optionProps(type, v, schema2));
      }
      view.choices.set(os.name, {
        props: {
          type, displayName: text(os.displayName), description: text(os.description),
          isGlobal: flag(os.isGlobal), sourceSolution: text(os.sourceSolution),
        },
        options,
      });
    }
  }

  for (const r of list(model.refs)) if (r.name) view.relationships.set(r.name, relationshipProps(r));
  return view;
}

// ── Comparison ─────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isEmpty = (v: unknown) => v === null || v === false || (Array.isArray(v) && v.length === 0);

/**
 * Property changes between two views of one item. Across model schemas (1.0.x → 1.1+) only values
 * both sides record are compared, so information 1.0.x did not capture is not reported as a change.
 */
function compareProps(a: Props, b: Props, sameSchema: boolean): Record<string, PropertyChange> | null {
  const changes: Record<string, PropertyChange> = {};
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    if (!sameSchema && (!(key in a) || !(key in b) || isEmpty(a[key]))) continue;
    if (!same(a[key] ?? null, b[key] ?? null)) changes[key] = { from: a[key] ?? null, to: b[key] ?? null };
  }
  return Object.keys(changes).length ? changes : null;
}

function sortedKeys<K extends string | number>(a: Map<K, unknown>, b: Map<K, unknown>): K[] {
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : compareStrings(String(x), String(y))));
}

const withName = (name: string, props: Props): Props => ({ name, ...props });

/** A removed item of the same scope with the same display name (and type), when there is exactly one. */
function markRenames(changes: DiffChange[], scopeOf: (c: DiffChange) => string, nameOf: (c: DiffChange) => string, typed: boolean): boolean {
  let marked = false;
  const signature = (c: DiffChange, props: Props | undefined) =>
    props?.displayName ? `${scopeOf(c)}|${props.displayName}|${typed ? props.type : ''}` : null;
  const removed = new Map<string, string[]>();
  for (const c of changes.filter((x) => x.op === 'removed')) {
    const sig = signature(c, c.before);
    if (sig) removed.set(sig, [...(removed.get(sig) ?? []), nameOf(c)]);
  }
  for (const c of changes.filter((x) => x.op === 'added')) {
    const sig = signature(c, c.after);
    const candidates = sig ? removed.get(sig) : undefined;
    if (candidates?.length === 1) {
      c.possibleRename = candidates[0];
      marked = true;
    }
  }
  return marked;
}

export function diffModels(from: Json | null, to: Json, refs: { from: string; to: string }): DiffResult {
  const a = viewOf(from);
  const b = viewOf(to);
  const sameSchema = a.schema === null || a.schema === b.schema;
  const byKind: Record<DiffKind, DiffChange[]> = {
    solution: [], table: [], column: [], optionSet: [], option: [], relationship: [], key: [],
  };

  for (const id of sortedKeys(a.solutions, b.solutions)) {
    const x = a.solutions.get(id);
    const y = b.solutions.get(id);
    if (x && !y) byKind.solution.push({ kind: 'solution', op: 'removed', solution: id, label: x.name as string, before: x });
    else if (!x && y) byKind.solution.push({ kind: 'solution', op: 'added', solution: id, label: y.name as string, after: y });
    else if (x && y) {
      const changes = compareProps(x, y, true);
      if (changes) byKind.solution.push({ kind: 'solution', op: 'modified', solution: id, label: y.name as string, changes });
    }
  }

  for (const id of sortedKeys(a.tables, b.tables)) {
    const x = a.tables.get(id);
    const y = b.tables.get(id);
    if (x && !y) {
      byKind.table.push({
        kind: 'table', op: 'removed', table: x.name, label: x.props.displayName as string | null, before: x.props,
        columns: [...x.columns].map(([n, p]) => withName(n, p)), keys: [...x.keys].map(([n, p]) => withName(n, p)),
      });
      continue;
    }
    if (!x && y) {
      byKind.table.push({
        kind: 'table', op: 'added', table: y.name, label: y.props.displayName as string | null, after: y.props,
        columns: [...y.columns].map(([n, p]) => withName(n, p)), keys: [...y.keys].map(([n, p]) => withName(n, p)),
      });
      continue;
    }
    if (!x || !y) continue;

    const changes = compareProps(x.props, y.props, sameSchema);
    if (changes) byKind.table.push({ kind: 'table', op: 'modified', table: y.name, label: y.props.displayName as string | null, changes });

    for (const column of sortedKeys(x.columns, y.columns)) {
      const c = x.columns.get(column);
      const d = y.columns.get(column);
      const base = { kind: 'column' as const, table: y.name, column };
      if (c && !d) byKind.column.push({ ...base, op: 'removed', label: c.displayName as string | null, before: c });
      else if (!c && d) byKind.column.push({ ...base, op: 'added', label: d.displayName as string | null, after: d });
      else if (c && d) {
        const columnChanges = compareProps(c, d, sameSchema);
        if (columnChanges) byKind.column.push({ ...base, op: 'modified', label: d.displayName as string | null, changes: columnChanges });
      }
    }

    for (const key of sortedKeys(x.keys, y.keys)) {
      const k = x.keys.get(key);
      const l = y.keys.get(key);
      const base = { kind: 'key' as const, table: y.name, key };
      if (k && !l) byKind.key.push({ ...base, op: 'removed', before: k });
      else if (!k && l) byKind.key.push({ ...base, op: 'added', after: l });
      else if (k && l) {
        const keyChanges = compareProps(k, l, true);
        if (keyChanges) byKind.key.push({ ...base, op: 'modified', changes: keyChanges });
      }
    }
  }

  for (const name of sortedKeys(a.choices, b.choices)) {
    const x = a.choices.get(name);
    const y = b.choices.get(name);
    const usedBy = b.usedBy.get(name) ?? a.usedBy.get(name) ?? [];
    const base = { kind: 'optionSet' as const, optionSet: name, usedBy };
    if (x && !y) {
      byKind.optionSet.push({ ...base, op: 'removed', label: x.props.displayName as string | null, before: x.props, options: [...x.options].map(([value, p]) => ({ value, ...p })) });
      continue;
    }
    if (!x && y) {
      byKind.optionSet.push({ ...base, op: 'added', label: y.props.displayName as string | null, after: y.props, options: [...y.options].map(([value, p]) => ({ value, ...p })) });
      continue;
    }
    if (!x || !y) continue;

    const changes = compareProps(x.props, y.props, sameSchema);
    if (changes) byKind.optionSet.push({ ...base, op: 'modified', label: y.props.displayName as string | null, changes });
    for (const value of sortedKeys(x.options, y.options)) {
      const o = x.options.get(value);
      const p = y.options.get(value);
      const optionBase = { kind: 'option' as const, optionSet: name, value, usedBy };
      if (o && !p) byKind.option.push({ ...optionBase, op: 'removed', label: o.label as string | null, before: o });
      else if (!o && p) byKind.option.push({ ...optionBase, op: 'added', label: p.label as string | null, after: p });
      else if (o && p) {
        const optionChanges = compareProps(o, p, sameSchema);
        if (optionChanges) byKind.option.push({ ...optionBase, op: 'modified', label: p.label as string | null, changes: optionChanges });
      }
    }
  }

  for (const name of sortedKeys(a.relationships, b.relationships)) {
    const x = a.relationships.get(name);
    const y = b.relationships.get(name);
    if (x && !y) byKind.relationship.push({ kind: 'relationship', op: 'removed', relationship: name, before: x });
    else if (!x && y) byKind.relationship.push({ kind: 'relationship', op: 'added', relationship: name, after: y });
    else if (x && y) {
      const changes = compareProps(x, y, sameSchema);
      if (changes) byKind.relationship.push({ kind: 'relationship', op: 'modified', relationship: name, changes });
    }
  }

  const notes: string[] = [];
  if (a.schema === null) notes.push(`There is no model at ${refs.from}; everything counts as added.`);
  else if (!sameSchema) {
    notes.push(`${refs.from} has model schema ${a.schema} and ${refs.to} schema ${b.schema}: only values both record are compared, so information the older dv-tools did not capture is not reported.`);
  }
  if (a.schema !== null && a.solutions.size === 0) notes.push(`${refs.from} has no provenance (dv-tools 1.0.x): its solution versions are unknown.`);

  const renamedTables = markRenames(byKind.table, () => '', (c) => c.table!, false);
  const renamedColumns = markRenames(byKind.column, (c) => c.table!, (c) => c.column!, true);
  if (renamedTables || renamedColumns) {
    notes.push('Dataverse logical names cannot be renamed: possibleRename only means that a removed and an added item share a display name.');
  }

  const changes = DIFF_KINDS.flatMap((kind) => byKind[kind]);
  const summary: DiffResult['summary'] = { total: changes.length, added: 0, removed: 0, modified: 0, byKind: {} as DiffResult['summary']['byKind'] };
  for (const kind of DIFF_KINDS) {
    summary.byKind[kind] = { added: 0, removed: 0, modified: 0 };
    for (const c of byKind[kind]) {
      summary.byKind[kind][c.op]++;
      summary[c.op]++;
    }
  }

  const side = (ref: string, model: Json | null, view: ModelView): DiffSide => ({
    ref,
    modelSchema: view.schema,
    solutions: list(model?.provenance?.layers).map((l) => ({
      order: l.order, name: l.name, uniqueName: l.uniqueName ?? null, version: l.version ?? null,
    })),
  });

  return { diffSchema: DIFF_SCHEMA, from: side(refs.from, from, a), to: side(refs.to, to, b), summary, changes, notes };
}
