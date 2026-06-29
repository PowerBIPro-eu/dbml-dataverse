import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyRelationship, ManyToManyRelationship, Relationship } from '../types.js';
import { xmlParser, CASCADE_ACTIONS } from './utils.js';

function parseRelFile(filePath: string): AnyRelationship[] {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf-8'); } catch { return []; }

  let doc: any;
  try { doc = xmlParser.parse(raw); } catch { return []; }

  // Root can be EntityRelationships (container) or a single EntityRelationship
  const rels: any[] = doc?.EntityRelationships?.EntityRelationship
    ?? (doc?.EntityRelationship ? [doc.EntityRelationship] : []);

  const results: AnyRelationship[] = [];

  for (const rel of rels) {
    const relName: string = rel['@_Name'] ?? '';
    const relType: string = String(rel.EntityRelationshipType ?? '');

    if (relType === 'OneToMany') {
      const referenced: string = String(rel.ReferencedEntityName ?? '');
      const referencing: string = String(rel.ReferencingEntityName ?? '');
      const fkCol: string = String(rel.ReferencingAttributeName ?? '').toLowerCase();
      const isHierarchical = String(rel.IsHierarchical) === '1';

      const cascades: Record<string, string> = {};
      for (const [xmlTag, settingKey] of CASCADE_ACTIONS) {
        const val = rel[xmlTag];
        if (val !== undefined && val !== null) cascades[settingKey] = String(val);
      }

      let navMany = '', navOne = '';
      let navPaneDisplay = '', navPaneArea = '';
      let navPaneOrder: number | null = null;

      for (const role of (rel.EntityRelationshipRoles?.EntityRelationshipRole ?? [])) {
        const roleType = String(role.RelationshipRoleType ?? '');
        const navName = String(role.NavigationPropertyName ?? '');
        if (roleType === '1') {
          navMany = navName;
          navPaneDisplay = String(role.NavPaneDisplayOption ?? '');
          navPaneArea = String(role.NavPaneArea ?? '');
          const order = role.NavPaneOrder;
          if (order !== undefined) {
            const n = parseInt(String(order), 10);
            if (!isNaN(n)) navPaneOrder = n;
          }
        } else if (roleType === '0') {
          navOne = navName;
        }
      }

      results.push({
        type: 'OneToMany',
        name: relName,
        referenced,
        referencing,
        fkCol,
        cascades,
        isHierarchical,
        navMany,
        navOne,
        navPaneDisplay,
        navPaneArea,
        navPaneOrder,
      } satisfies Relationship);
    } else if (relType === 'ManyToMany') {
      const first: string = String(rel.Entity1LogicalName ?? rel.FirstEntityName ?? '');
      const second: string = String(rel.Entity2LogicalName ?? rel.SecondEntityName ?? '');
      const intersect: string = String(rel.IntersectEntityName ?? '');
      results.push({
        type: 'ManyToMany',
        name: relName,
        first,
        second,
        intersect,
      } satisfies ManyToManyRelationship);
    }
  }
  return results;
}

/** Parse all relationship files from a folder. */
function parseRelFolder(folderPath: string): AnyRelationship[] {
  if (!existsSync(folderPath)) return [];
  const results: AnyRelationship[] = [];
  for (const fn of readdirSync(folderPath)) {
    if (!String(fn).endsWith('.xml')) continue;
    results.push(...parseRelFile(join(folderPath, fn)));
  }
  return results;
}

/** Deduplicate relationships by name. */
function deduplicate(rels: AnyRelationship[]): AnyRelationship[] {
  const seen = new Set<string>();
  const result: AnyRelationship[] = [];
  for (const rel of rels) {
    if (rel.name && seen.has(rel.name)) continue;
    if (rel.name) seen.add(rel.name);
    result.push(rel);
  }
  return result;
}

/** Parse all relationships from entity subfolders and the global relationships folder. */
export function parseAllRelationships(
  entitiesPath: string,
  globalRelsPath: string | null,
): AnyRelationship[] {
  const all: AnyRelationship[] = [];

  // Per-entity Relationships sub-folder
  if (existsSync(entitiesPath)) {
    for (const item of readdirSync(entitiesPath, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      all.push(...parseRelFolder(join(entitiesPath, item.name, 'Relationships')));
    }
  }

  // Global relationships folder (alternative layout)
  if (globalRelsPath) {
    all.push(...parseRelFolder(globalRelsPath));
  }

  return deduplicate(all);
}
