import { compareStrings } from '../util.js';

// Post-parse step: the DBML stays as it is (the fork rejects unknown DBML settings), and
// model.json gets its schema-2 shape here — no parser noise, stable order, provenance and
// the facts dv-tools knows from the XML.

export const MODEL_SCHEMA = 2;
export const GENERATOR_NAME = '@powerbipro-eu/dv-tools';

export interface ProvenanceLayer {
  order: number;
  name: string;
  path: string;                 // solution folder, relative to the model.json folder
  uniqueName: string | null;
  displayName: string | null;
  version: string | null;
  publisher: { uniqueName: string | null; customizationPrefix: string | null; optionValuePrefix: number | null } | null;
}

export interface Provenance {
  generator: { name: string; version: string };
  config: string | null;        // options file, relative to the model.json folder
  layers: ProvenanceLayer[];
}

export interface FieldFacts {
  isCustom: boolean;
  description: string;          // full description, character references decoded
  modifications: string[];      // e.g. ['statusReasons'] for a platform column we changed
}

export interface TableFacts {
  logicalName: string;
  isCustom: boolean;
  isPartial: boolean;
  fields: Map<string, FieldFacts>;
}

export interface ModelFacts {
  tables: Map<string, TableFacts>;            // by table name
  customStatusValues: Map<string, Set<number>>; // status option set name → values we added
  extraRefs: Json[];                          // N:N that DBML cannot hold (same endpoints), parser shape
}

type Json = Record<string, any>;

const byName = (a: Json, b: Json) => compareStrings(a.name ?? '', b.name ?? '');

/** Drop the parser's source positions: `token` (offset/line/column) and `filepath`. */
function stripTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTokens);
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === 'token' || key === 'filepath') continue;
      out[key] = stripTokens(v);
    }
    return out;
  }
  return value;
}

function finalizeField(field: Json, facts: FieldFacts | undefined): Json {
  const { name, ...rest } = field;
  const out: Json = { name, isCustom: facts?.isCustom ?? false };
  if (facts?.modifications.length) {
    out.isModified = true;
    out.modifications = facts.modifications;
  }
  Object.assign(out, rest);
  if (facts?.description) out.description = facts.description;
  return out;
}

function finalizeTable(table: Json, facts: TableFacts | undefined): Json {
  const { name, ...rest } = table;
  const out: Json = { name, logicalName: facts?.logicalName ?? String(name).toLowerCase(), isCustom: facts?.isCustom ?? false };
  if (facts?.isPartial) out.isPartial = true;
  // Existing values stay as 1.0.x wrote them (e.g. a table description keeps its `&#xA;`): changes are additive
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'fields') out.fields = (value as Json[]).map((f) => finalizeField(f, facts?.fields.get(f.name)));
    else if (key === 'indexes') out.indexes = [...(value as Json[])].sort(byName);
    else out[key] = value;
  }
  return out;
}

export function finalizeModel(raw: object, facts: ModelFacts, provenance: Provenance): Json {
  const model = stripTokens(raw) as Json;
  const out: Json = { modelSchema: MODEL_SCHEMA, provenance };

  for (const [key, value] of Object.entries(model)) {
    switch (key) {
      case 'tables':
        out.tables = (value as Json[])
          .map((t) => finalizeTable(t, facts.tables.get(t.name)))
          .sort((a, b) => compareStrings(a.logicalName, b.logicalName) || compareStrings(a.name, b.name));
        break;
      case 'refs':
        out.refs = [...(value as Json[]), ...facts.extraRefs].sort(byName);
        break;
      case 'optionSets':
      case 'stateOptionSets':
        out[key] = [...(value as Json[])].sort(byName);
        break;
      case 'statusOptionSets':
        out[key] = [...(value as Json[])].sort(byName).map((os) => {
          const ours = facts.customStatusValues.get(os.name);
          if (!ours?.size) return os;
          return { ...os, values: (os.values as Json[]).map((v) => (ours.has(v.value) ? { ...v, isCustom: true } : v)) };
        });
        break;
      case 'bitOptionSets':
        // `values` next to trueLabel/falseLabel, so readers that expect a value list see the labels
        out[key] = [...(value as Json[])].sort(byName).map((os) => ({
          ...os,
          values: [{ value: 1, label: os.trueLabel }, { value: 0, label: os.falseLabel }],
        }));
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/** model.json text: 2-space JSON, LF, trailing newline. */
export function serializeModel(model: Json): string {
  return JSON.stringify(model, null, 2) + '\n';
}
