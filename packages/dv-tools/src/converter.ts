import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import type { AnyRelationship, ConvertOptions, Entity, GlobalOptionSet, Relationship } from './types.js';
import { parseEntityXml, parseOptionSetsFolder } from './xml/parseEntity.js';
import { parseAllRelationships } from './xml/parseRelationships.js';
import { emitEntityFile, emitGlobalOptionSetsFile } from './emit/dbml.js';
import { buildModelJson } from './model/json.js';
import { type SolutionLayer, deriveSolutionName, mergeSolutions } from './merge.js';

// ── Path resolution ────────────────────────────────────────────────────────

function resolvePaths(inputPath: string): {
  entitiesPath: string;
  optionSetsPath: string | null;
  globalRelsPath: string | null;
} {
  const abs = resolve(inputPath);

  // Check common solution layouts
  const tryPaths = [
    { entities: join(abs, 'src', 'Entities'), optionSets: join(abs, 'src', 'OptionSets'), rels: join(abs, 'src', 'Other', 'Relationships') },
    { entities: join(abs, 'Entities'),         optionSets: join(abs, 'OptionSets'),       rels: join(abs, 'Other', 'Relationships') },
  ];

  for (const p of tryPaths) {
    if (existsSync(p.entities)) {
      return {
        entitiesPath: p.entities,
        optionSetsPath: existsSync(p.optionSets) ? p.optionSets : null,
        globalRelsPath: existsSync(p.rels) ? p.rels : null,
      };
    }
  }

  // User pointed directly at an Entities folder
  if (basename(abs) === 'Entities' && existsSync(abs)) {
    const parent = dirname(abs);
    const osPath = join(parent, 'OptionSets');
    const relPath = join(parent, 'Other', 'Relationships');
    return {
      entitiesPath: abs,
      optionSetsPath: existsSync(osPath) ? osPath : null,
      globalRelsPath: existsSync(relPath) ? relPath : null,
    };
  }

  throw new Error(`Could not find an Entities folder under: ${abs}`);
}

// ── Parse a single solution into a SolutionLayer ──────────────────────────

function parseSolution(inputPath: string, solutionName: string): SolutionLayer {
  const { entitiesPath, optionSetsPath, globalRelsPath } = resolvePaths(inputPath);

  const globalOptionSets: Map<string, GlobalOptionSet> = optionSetsPath
    ? parseOptionSetsFolder(optionSetsPath)
    : new Map();
  console.error(`[${solutionName}] Parsed ${globalOptionSets.size} global option sets`);

  const entities = new Map<string, Entity>();
  if (existsSync(entitiesPath)) {
    for (const item of readdirSync(entitiesPath, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const entity = parseEntityXml(join(entitiesPath, item.name, 'Entity.xml'));
      if (!entity) continue;
      entities.set(entity.name, entity);
    }
  }
  console.error(`[${solutionName}] Parsed ${entities.size} entities`);

  const relationships = parseAllRelationships(entitiesPath, globalRelsPath);
  console.error(`[${solutionName}] Parsed ${relationships.length} relationships`);

  return { name: solutionName, entities, globalOptionSets, relationships };
}

// ── Enrichment: populate lookup targets ───────────────────────────────────

function enrichLookupTargets(
  entities: Map<string, Entity>,
  relationships: AnyRelationship[],
): void {
  // Build map: (referencing_entity, fk_col) → referenced_entity
  const targetMap = new Map<string, string>();
  for (const rel of relationships) {
    if (rel.type === 'OneToMany' && rel.fkCol) {
      const r = rel as Relationship;
      targetMap.set(`${r.referencing}::${r.fkCol}`, r.referenced);
    }
  }

  for (const entity of entities.values()) {
    for (const attr of entity.attributes) {
      const baseType = attr.type.split('(')[0];
      if (['lookup', 'owner', 'customer'].includes(baseType)) {
        const target = targetMap.get(`${entity.name}::${attr.name}`);
        if (target && entities.has(target)) {
          attr.lookupTargets = [target];
        }
      }
    }
  }
}

// ── Group relationships by parent entity ──────────────────────────────────

function groupRelsByParent(
  relationships: AnyRelationship[],
  entities: Map<string, Entity>,
): Map<string, AnyRelationship[]> {
  const map = new Map<string, AnyRelationship[]>();
  const seenNN = new Set<string>();

  for (const rel of relationships) {
    if (rel.type === 'OneToMany') {
      const r = rel as Relationship;
      if (!entities.has(r.referenced) || !entities.has(r.referencing)) continue;
      const list = map.get(r.referenced) ?? [];
      list.push(r);
      map.set(r.referenced, list);
    } else {
      // ManyToMany — emit from the "first" entity, avoid duplicates
      const mn = rel as { type: 'ManyToMany'; name: string; first: string; second: string; intersect: string };
      const nnKey = [mn.first, mn.second].sort().join('::');
      if (seenNN.has(nnKey)) continue;
      seenNN.add(nnKey);
      if (entities.has(mn.first)) {
        const list = map.get(mn.first) ?? [];
        list.push(rel);
        map.set(mn.first, list);
      }
    }
  }
  return map;
}

// ── Main converter ─────────────────────────────────────────────────────────

export async function convert(
  inputPaths: string | string[],
  options: ConvertOptions,
): Promise<void> {
  const paths = Array.isArray(inputPaths) ? inputPaths : [inputPaths];
  const explicitNames = options.solutionNames ?? [];

  // 1. Parse each solution into a layer
  const layers = paths.map((p, i) => {
    const name = explicitNames[i] ?? deriveSolutionName(p);
    return parseSolution(p, name);
  });

  // 2. Merge all layers
  const { entities, globalOptionSets, relationships } = mergeSolutions(layers);
  console.error(`Merged: ${entities.size} entities, ${globalOptionSets.size} global option sets, ${relationships.length} relationships`);

  // 3. Build pk map
  const pkMap = new Map<string, string>();
  for (const entity of entities.values()) {
    const pk = entity.attributes.find((a) => a.isPk);
    if (pk) pkMap.set(entity.name, pk.name);
  }

  // 4. Enrich lookup targets (second pass)
  enrichLookupTargets(entities, relationships);

  // 5. Group relationships by parent entity
  const relsByParent = groupRelsByParent(relationships, entities);

  // 6. Build DBML strings (in memory)
  mkdirSync(options.outputDir, { recursive: true });

  const dbmlParts: string[] = [];

  if (globalOptionSets.size > 0) {
    const content = emitGlobalOptionSetsFile(globalOptionSets);
    dbmlParts.push(content);
    if (options.writeDbml) {
      writeFileSync(join(options.outputDir, 'global_option_sets.dv.dbml'), content, 'utf-8');
      console.error(`Written: global_option_sets.dv.dbml`);
    }
  }

  for (const [entityName, entity] of entities) {
    const content = emitEntityFile(
      entity, pkMap,
      options.colors[entityName],
      relsByParent.get(entityName) ?? [],
    );
    dbmlParts.push(content);
    if (options.writeDbml) {
      writeFileSync(join(options.outputDir, `${entityName}.dv.dbml`), content, 'utf-8');
      console.error(`Written: ${entityName}.dv.dbml`);
    }
  }

  // 7. Parse combined DBML → model.json
  const combined = dbmlParts.join('\n\n');
  let modelJson: object;
  try {
    modelJson = buildModelJson(combined);
  } catch (err: any) {
    if (err?.diags?.length) {
      console.error('\nDBML validation errors:');
      for (const d of err.diags) {
        const loc = d.location ? ` (line ${d.location.start?.line ?? '?'})` : '';
        console.error(`  • ${d.message}${loc}`);
      }
    } else {
      console.error('DBML parse error:', err?.message ?? err);
    }
    process.exit(1);
  }

  const modelPath = join(options.outputDir, 'model.json');
  writeFileSync(modelPath, JSON.stringify(modelJson, null, 2), 'utf-8');
  console.error(`Written: model.json`);
}

// ── Single-entity mode ─────────────────────────────────────────────────────

export async function convertSingleEntity(entityXmlPath: string, outputDir: string): Promise<void> {
  const entity = parseEntityXml(entityXmlPath);
  if (!entity) {
    console.error('Could not parse entity from:', entityXmlPath);
    process.exit(1);
  }

  const pkMap = new Map<string, string>();
  const pk = entity.attributes.find((a) => a.isPk);
  if (pk) pkMap.set(entity.name, pk.name);

  mkdirSync(outputDir, { recursive: true });
  const content = emitEntityFile(entity, pkMap, undefined, []);
  writeFileSync(join(outputDir, `${entity.name}.dv.dbml`), content, 'utf-8');
  console.error(`Written: ${entity.name}.dv.dbml`);

  try {
    const modelJson = buildModelJson(content);
    writeFileSync(join(outputDir, 'model.json'), JSON.stringify(modelJson, null, 2), 'utf-8');
    console.error('Written: model.json');
  } catch (err: any) {
    console.error('DBML parse warning (model.json not written):', err?.message ?? err);
  }
}
