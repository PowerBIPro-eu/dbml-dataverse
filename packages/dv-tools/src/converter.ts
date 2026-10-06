import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AnyRelationship, Attribute, ConvertOptions, Entity, ManyToManyRelationship, PlatformTables,
  SolutionInfo, SolutionInput,
} from './types.js';
import { parseEntitiesFolder, parseEntityXml, parseOptionSetsFolder } from './xml/parseEntity.js';
import { parseAllRelationships } from './xml/parseRelationships.js';
import { EXCLUDED_ENTITIES, PLATFORM_ACTIVITY_TABLES, decodeCharRefs } from './xml/utils.js';
import { emitEntityFile, emitGlobalOptionSetsFile } from './emit/dbml.js';
import { buildModelJson, DbmlCompileError } from './model/json.js';
import {
  finalizeModel, serializeModel, GENERATOR_NAME,
  type FieldFacts, type ModelFacts, type Provenance, type TableFacts,
} from './model/finalize.js';
import { type SolutionLayer, mergeSolutions } from './merge.js';
import { readSolutionXml, resolvePaths, type SolutionPaths } from './solution.js';
import { buildComponents, COMPONENTS_FILE, readLayerComponents, serializeComponents } from './components/components.js';
import { readPipelines, type CustomApiImplementation } from './components/pipelines.js';
import { InputError, UsageError } from './errors.js';
import { compareStrings, portableRelative } from './util.js';
import { VERSION } from './version.js';
import type { OutputFile } from './output.js';

export interface BuildResult {
  files: OutputFile[];
  layers: Array<{ input: SolutionInput; info: SolutionInfo }>;
}

// ── Parse a single solution into a SolutionLayer ──────────────────────────

interface ParsedSolution {
  input: SolutionInput;
  info: SolutionInfo;
  paths: SolutionPaths;
  layer: SolutionLayer;
}

function parseSolution(input: SolutionInput): ParsedSolution {
  const paths = resolvePaths(input.path);
  const info = readSolutionXml(paths.solutionXmlPath);
  if (input.uniqueName && input.uniqueName.toLowerCase() !== (info.uniqueName ?? '').toLowerCase()) {
    const found = paths.solutionXmlPath ? `its Solution.xml has '${info.uniqueName ?? ''}'` : 'it has no Solution.xml';
    throw new UsageError(`solution '${input.name}' should have uniqueName '${input.uniqueName}', but ${found}`);
  }

  const globalOptionSets = paths.optionSetsPath ? parseOptionSetsFolder(paths.optionSetsPath) : new Map();
  console.error(`[${input.name}] Parsed ${globalOptionSets.size} global option sets`);
  const entities = parseEntitiesFolder(paths.entitiesPath);
  console.error(`[${input.name}] Parsed ${entities.size} entities`);
  const relationships = parseAllRelationships(paths.entitiesPath, paths.globalRelsPath);
  console.error(`[${input.name}] Parsed ${relationships.length} relationships`);

  return { input, info, paths, layer: { name: input.name, entities, globalOptionSets, relationships } };
}

// ── Our tables vs platform tables ──────────────────────────────────────────

/** Publisher prefixes (`ddsol_`) of all layers; a table whose name starts with one is ours. */
function publisherPrefixes(infos: SolutionInfo[]): string[] {
  const prefixes = new Set<string>();
  for (const info of infos) {
    const prefix = info.publisher?.customizationPrefix;
    if (prefix) prefixes.add(`${prefix.toLowerCase()}_`);
  }
  return [...prefixes].sort(compareStrings);
}

function isOurTable(logicalName: string, prefixes: string[]): boolean {
  // Without any Solution.xml, fall back to "has a publisher-style prefix"
  return prefixes.length ? prefixes.some((p) => logicalName.startsWith(p)) : /^[a-z0-9]+_/.test(logicalName);
}

// ── Status reasons: which values are ours, and is statuscode modified ─────

/** Custom option values start with the publisher's 5-digit option-value prefix: 9 digits. */
const CUSTOM_OPTION_VALUE_MIN = 100_000_000;

/** State → default status reason of a table as the platform creates it. */
const STATUS_BASELINE = {
  table: new Map([[0, 1], [1, 2]]),
  activity: new Map([[0, 1], [1, 2], [2, 3], [3, 4]]),
};

interface StatusFacts {
  optionSetName: string;
  fieldName: string;
  customValues: Set<number>;
  modified: boolean;
}

function localSetOf(entity: Entity, type: 'state' | 'status') {
  const field = entity.attributes.find((a) => a.type === type && a.optionSetName);
  const set = field ? entity.localOptionSets.get(field.optionSetName!) : undefined;
  return field && set?.type === type ? { field, set } : null;
}

function analyzeStatus(entity: Entity, ours: boolean): StatusFacts | null {
  const status = localSetOf(entity, 'status');
  if (!status) return null;
  const values = status.set.statuses!.map((s) => s.value);
  const facts = (customValues: Set<number>, modified: boolean): StatusFacts =>
    ({ optionSetName: status.set.name, fieldName: status.field.name, customValues, modified });

  if (!ours) {
    // Platform tables ship their own status reasons (Task: 2–7), so only 9-digit values are ours
    const customValues = new Set(values.filter((v) => v >= CUSTOM_OPTION_VALUE_MIN));
    return facts(customValues, customValues.size > 0);
  }

  // Tables we created: compare with the baseline, which also catches removed values and changed defaults
  const baseline = entity.isActivity ? STATUS_BASELINE.activity : STATUS_BASELINE.table;
  const baseStatuses = new Set(baseline.values());
  const customValues = new Set(values.filter((v) => !baseStatuses.has(v)));
  const removed = [...baseStatuses].some((v) => !values.includes(v));
  const defaultChanged = localSetOf(entity, 'state')?.set.states!.some(
    (s) => s.defaultStatus !== null && baseline.has(s.value) && baseline.get(s.value) !== s.defaultStatus,
  ) ?? false;
  return facts(customValues, customValues.size > 0 || removed || defaultChanged);
}

// ── Which tables end up in the model ───────────────────────────────────────

interface TableClass {
  ours: boolean;
  status: StatusFacts | null;
}

const EXCLUDED = new Set([...EXCLUDED_ENTITIES].map((n) => n.toLowerCase()));

function selectTables(entities: Map<string, Entity>, prefixes: string[], mode: PlatformTables): Map<string, TableClass> {
  const selected = new Map<string, TableClass>();
  for (const entity of entities.values()) {
    const ours = isOurTable(entity.name.toLowerCase(), prefixes);
    const status = analyzeStatus(entity, ours);
    // 1.0.x kept every fully defined platform table except the excluded system tables
    const fullyDefined = entity.hasPrimaryKey && !EXCLUDED.has(entity.name.toLowerCase());
    const carriesOurs = entity.attributes.some((a) => a.isCustom) || !!status?.modified;
    const keep = ours || mode === 'all' || (mode === 'with-our-columns' && (fullyDefined || carriesOurs));
    if (keep) selected.set(entity.name, { ours, status });
  }
  return selected;
}

/** A table whose XML only has some columns gets its key: activityid for activities, else <logical>id. */
function addSyntheticPrimaryKey(entity: Entity): void {
  const logical = entity.name.toLowerCase();
  if (!entity.isActivityKnown && PLATFORM_ACTIVITY_TABLES.has(logical)) entity.isActivity = true;
  const name = entity.isActivity ? 'activityid' : `${logical}id`;
  const existing = entity.attributes.find((a) => a.name === name);
  if (existing) {
    existing.isPk = true;
    return;
  }
  const pk: Attribute = {
    name, type: 'primarykey', required: 'systemrequired', isPk: true, isCustom: false,
    sourceType: 'simple', autoNumber: '', format: '', displayName: '', description: '',
    optionSetName: null, lookupTargets: [],
  };
  entity.attributes.unshift(pk);
}

const byTableOrder = (a: Entity, b: Entity) =>
  compareStrings(a.name.toLowerCase(), b.name.toLowerCase()) || compareStrings(a.name, b.name);

// ── Enrichment: lookup targets ─────────────────────────────────────────────

const LOOKUP_TYPES = ['lookup', 'owner', 'customer'];

/** Targets come from every 1:N relationship; tables outside the model keep their XML name. */
function enrichLookupTargets(
  entities: Map<string, Entity>,
  relationships: AnyRelationship[],
  tableNames: Map<string, string>,
): void {
  // (referencing table, lookup column) → lowercase target → target name
  const targets = new Map<string, Map<string, string>>();
  for (const rel of relationships) {
    if (rel.type !== 'OneToMany' || !rel.fkCol) continue;
    const key = `${rel.referencing.toLowerCase()}::${rel.fkCol}`;
    const byLower = targets.get(key) ?? new Map<string, string>();
    const lower = rel.referenced.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, tableNames.get(lower) ?? rel.referenced);
    targets.set(key, byLower);
  }

  for (const entity of entities.values()) {
    for (const attr of entity.attributes) {
      if (!LOOKUP_TYPES.includes(attr.type.split('(')[0])) continue;
      const found = targets.get(`${entity.name.toLowerCase()}::${attr.name}`);
      if (found) attr.lookupTargets = [...found.values()].sort(compareStrings);
    }
  }
}

// ── Group relationships by parent entity ──────────────────────────────────

interface GroupedRelationships {
  byParent: Map<string, AnyRelationship[]>;
  /**
   * N:N that DBML cannot hold: a second N:N between the same two tables, or a table related
   * to itself (DBML rejects refs with the same endpoints). They go into model.json directly.
   */
  modelOnly: ManyToManyRelationship[];
}

function groupRelsByParent(
  relationships: AnyRelationship[],
  entities: Map<string, Entity>,
  tableNames: Map<string, string>,
): GroupedRelationships {
  const byParent = new Map<string, AnyRelationship[]>();
  const add = (parent: string, rel: AnyRelationship) => byParent.set(parent, [...(byParent.get(parent) ?? []), rel]);
  const manyToManyByPair = new Map<string, ManyToManyRelationship[]>();

  for (const rel of relationships) {
    if (rel.type === 'OneToMany') {
      const referenced = tableNames.get(rel.referenced.toLowerCase());
      const referencing = tableNames.get(rel.referencing.toLowerCase());
      if (!referenced || !referencing) continue;
      // the lookup column may be left out of the model (system columns such as owninguser)
      if (!entities.get(referencing)!.attributes.some((a) => a.name === rel.fkCol)) continue;
      add(referenced, { ...rel, referenced, referencing });
    } else {
      // XML names may be logical (lowercase) or schema names
      const first = tableNames.get(rel.first.toLowerCase());
      const second = tableNames.get(rel.second.toLowerCase());
      if (!first || !second) continue;
      const pair = [first, second].sort(compareStrings).join('::');
      const resolved = { ...rel, name: rel.name || `${rel.first}_${rel.second}`, first, second };
      manyToManyByPair.set(pair, [...(manyToManyByPair.get(pair) ?? []), resolved]);
    }
  }

  // Every N:N is kept: the first per pair of tables (by name) as a DBML Ref, the others model-only
  const modelOnly: ManyToManyRelationship[] = [];
  for (const group of manyToManyByPair.values()) {
    group.sort((a, b) => compareStrings(a.name, b.name));
    const selfReference = group[0].first === group[0].second;
    if (!selfReference) add(group[0].first, group[0]);
    modelOnly.push(...(selfReference ? group : group.slice(1)));
  }

  for (const list of byParent.values()) list.sort((a, b) => compareStrings(a.name, b.name));
  return { byParent, modelOnly: modelOnly.sort((a, b) => compareStrings(a.name, b.name)) };
}

/** model.json ref for a model-only N:N, in the parser's shape. */
function manyToManyRefJson(rel: ManyToManyRelationship, pkMap: Map<string, string>): Record<string, unknown> {
  const endpoint = (tableName: string) =>
    ({ schemaName: null, tableName, fieldNames: [pkMap.get(tableName)!], relation: '*' });
  return {
    name: rel.name,
    schemaName: null,
    endpoints: [endpoint(rel.first), endpoint(rel.second)],
    ...(rel.intersect ? { intersectEntity: rel.intersect } : {}),
    ...(rel.sourceSolution ? { sourceSolution: rel.sourceSolution } : {}),
  };
}

// ── DBML → model.json ──────────────────────────────────────────────────────

/** LF line endings and exactly one trailing newline. */
function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');
}

/** Compile the .dv.dbml files together; errors name the file and line they come from. */
function compile(files: OutputFile[]): object {
  const starts: Array<{ name: string; line: number }> = [];
  let line = 1;
  for (const file of files) {
    starts.push({ name: file.name, line });
    line += file.content.split('\n').length;
  }

  try {
    return buildModelJson(files.map((f) => f.content).join('\n'));
  } catch (err) {
    if (!(err instanceof DbmlCompileError)) throw err;
    throw new DbmlCompileError(err.diags.map((d) => {
      const start = [...starts].reverse().find((s) => s.line <= d.location.start.line) ?? starts[0];
      return { ...d, file: start.name, location: { start: { ...d.location.start, line: d.location.start.line - start.line + 1 } } };
    }));
  }
}

function colorLookup(colors: Record<string, string>): (name: string) => string | undefined {
  const byLower = new Map<string, string>();
  for (const key of Object.keys(colors).sort(compareStrings)) byLower.set(key.toLowerCase(), colors[key]);
  return (name) => byLower.get(name.toLowerCase());
}

function tableFacts(entity: Entity, cls: TableClass): TableFacts {
  const fields = new Map<string, FieldFacts>();
  for (const attr of entity.attributes) {
    fields.set(attr.name, {
      isCustom: attr.isCustom,
      description: decodeCharRefs(attr.description),
      modifications: cls.status?.modified && cls.status.fieldName === attr.name ? ['statusReasons'] : [],
    });
  }
  return { logicalName: entity.name.toLowerCase(), isCustom: cls.ours, isPartial: !entity.hasPrimaryKey, fields };
}

function modelFacts(
  entities: Map<string, Entity>,
  classes: Map<string, TableClass>,
  extraRefs: Record<string, unknown>[] = [],
): ModelFacts {
  const facts: ModelFacts = { tables: new Map(), customStatusValues: new Map(), extraRefs };
  for (const [name, entity] of entities) {
    const cls = classes.get(name)!;
    facts.tables.set(name, tableFacts(entity, cls));
    if (cls.status?.customValues.size) facts.customStatusValues.set(cls.status.optionSetName, cls.status.customValues);
  }
  return facts;
}

function provenanceFor(solutions: ParsedSolution[], outputDir: string, configPath: string | null): Provenance {
  return {
    generator: { name: GENERATOR_NAME, version: VERSION },
    config: configPath ? portableRelative(outputDir, configPath) : null,
    layers: solutions.map(({ input, info }, i) => ({
      order: i + 1,
      name: input.name,
      path: portableRelative(outputDir, input.path),
      uniqueName: info.uniqueName,
      displayName: info.displayName,
      version: info.version,
      publisher: info.publisher,
    })),
  };
}

// ── Components: plugins, flows, processes ──────────────────────────────────

/** Entity set name (as cloud flows name tables) or logical name → logical name, from every layer's XML. */
function entityLookup(solutions: ParsedSolution[]): (name: string) => string | null {
  const bySetName = new Map<string, string>();
  const logicalNames = new Set<string>();
  for (const { layer } of solutions) {
    for (const entity of layer.entities.values()) {
      const logical = entity.name.toLowerCase();
      logicalNames.add(logical);
      const setName = entity.entitySetName.toLowerCase();
      if (setName && !bySetName.has(setName)) bySetName.set(setName, logical);
    }
  }
  return (name) => {
    const lower = name.toLowerCase();
    return bySetName.get(lower) ?? (logicalNames.has(lower) ? lower : null);
  };
}

function componentsFile(solutions: ParsedSolution[], provenance: Provenance, options: ConvertOptions): OutputFile {
  const entityOf = entityLookup(solutions);
  const layers = solutions.map(({ input, paths }) => ({
    name: input.name,
    components: readLayerComponents(input.name, paths.rootPath, input.path, entityOf),
  }));
  const pluginsPath = options.pluginsPath;
  const pipelines = pluginsPath
    ? {
      source: portableRelative(options.outputDir, pluginsPath),
      read: (registeredTypes: string[], customApis: CustomApiImplementation[]) => {
        const found = readPipelines(pluginsPath, registeredTypes, customApis, (message) => console.error(`[Plugins] Warning: ${message}`));
        const unknownMessages = found.flatMap((p) => p.messages).filter((m) => m.composition === 'unknown').length;
        console.error(`[Plugins] Read ${found.length} plug-ins: ${found.filter((p) => p.composition === 'unknown').length} unknown, `
          + `${unknownMessages} unknown messages`);
        return found;
      },
    }
    : null;
  return { name: COMPONENTS_FILE, content: serializeComponents(buildComponents(layers, provenance, pipelines)) };
}

// ── Main converter ─────────────────────────────────────────────────────────

/** Build every output file in memory; nothing is written. Throws UsageError / DbmlCompileError. */
export function buildOutputs(options: ConvertOptions): BuildResult {
  // 1. Parse each solution into a layer, then merge (base layer first)
  const solutions = options.solutions.map(parseSolution);
  const merged = mergeSolutions(solutions.map((s) => s.layer));

  // 2. Decide which tables are in the model
  const prefixes = publisherPrefixes(solutions.map((s) => s.info));
  if (!prefixes.length) console.error('Warning: no Solution.xml found; tables with a publisher-style prefix (xxx_) are treated as ours.');
  const classes = selectTables(merged.entities, prefixes, options.platformTables);

  const entities = new Map<string, Entity>();
  for (const entity of [...merged.entities.values()].filter((e) => classes.has(e.name)).sort(byTableOrder)) {
    if (!entity.hasPrimaryKey) addSyntheticPrimaryKey(entity);
    entities.set(entity.name, entity);
  }
  console.error(`Merged: ${entities.size} entities, ${merged.globalOptionSets.size} global option sets, ${merged.relationships.length} relationships`);

  // 3. Keys, lookup targets and relationships (table names resolved case-insensitively)
  const tableNames = new Map([...entities.keys()].map((name) => [name.toLowerCase(), name]));
  const pkMap = new Map([...entities.values()].map((e) => [e.name, e.attributes.find((a) => a.isPk)!.name]));
  enrichLookupTargets(entities, merged.relationships, tableNames);
  const { byParent, modelOnly } = groupRelsByParent(merged.relationships, entities, tableNames);

  // 4. DBML text per file, in memory
  const colorOf = colorLookup(options.colors);
  const dbmlFiles: OutputFile[] = [];
  if (merged.globalOptionSets.size > 0) {
    dbmlFiles.push({ name: 'global_option_sets.dv.dbml', content: normalizeText(emitGlobalOptionSetsFile(merged.globalOptionSets)) });
  }
  for (const [name, entity] of entities) {
    let content = emitEntityFile(entity, pkMap, colorOf(name), byParent.get(name) ?? []);
    for (const rel of modelOnly.filter((r) => r.first === name)) {
      content += `\n// Many-to-many ${rel.name} (${rel.first} <> ${rel.second}) is in model.json only: DBML allows one Ref per pair of tables\n`;
    }
    dbmlFiles.push({ name: `${name}.dv.dbml`, content: normalizeText(content) });
  }

  // 5. Compile, finalize: model.json exists only if all DBML is valid
  const provenance = provenanceFor(solutions, options.outputDir, options.configPath);
  const model = finalizeModel(
    compile(dbmlFiles),
    modelFacts(entities, classes, modelOnly.map((rel) => manyToManyRefJson(rel, pkMap))),
    provenance,
  );

  // 6. components.json, from the same solution folders (written before model.json)
  const components = options.writeComponents ? [componentsFile(solutions, provenance, options)] : [];

  return {
    files: [...(options.writeDbml ? dbmlFiles : []), ...components, { name: 'model.json', content: serializeModel(model) }],
    layers: solutions.map(({ input, info }) => ({ input, info })),
  };
}

// ── Single-entity mode ─────────────────────────────────────────────────────

export function buildSingleEntity(entityXmlPath: string): BuildResult {
  const entity = parseEntityXml(entityXmlPath);
  if (!entity) throw new InputError(`Could not parse entity from: ${entityXmlPath}`);

  // <solution>/Entities/<name>/Entity.xml → <solution>/Other/Solution.xml, when there is one
  const solutionXml = join(dirname(dirname(dirname(entityXmlPath))), 'Other', 'Solution.xml');
  const ours = isOurTable(entity.name.toLowerCase(), publisherPrefixes([readSolutionXml(existsSync(solutionXml) ? solutionXml : null)]));
  const classes = new Map([[entity.name, { ours, status: analyzeStatus(entity, ours) }]]);
  if (!entity.hasPrimaryKey) addSyntheticPrimaryKey(entity);

  const pkMap = new Map([[entity.name, entity.attributes.find((a) => a.isPk)!.name]]);
  const dbml: OutputFile = { name: `${entity.name}.dv.dbml`, content: normalizeText(emitEntityFile(entity, pkMap, undefined, [])) };
  const provenance: Provenance = { generator: { name: GENERATOR_NAME, version: VERSION }, config: null, layers: [] };
  const model = finalizeModel(compile([dbml]), modelFacts(new Map([[entity.name, entity]]), classes), provenance);

  return { files: [dbml, { name: 'model.json', content: serializeModel(model) }], layers: [] };
}
