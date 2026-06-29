import { basename } from 'node:path';
import type { AnyRelationship, Entity, GlobalOptionSet, ManyToManyRelationship, Relationship } from './types.js';

// ── Solution layer (one solution's parsed data) ────────────────────────────

export interface SolutionLayer {
  name: string;
  entities: Map<string, Entity>;
  globalOptionSets: Map<string, GlobalOptionSet>;
  relationships: AnyRelationship[];
}

// ── Merged result ──────────────────────────────────────────────────────────

export interface MergedModel {
  entities: Map<string, Entity>;
  globalOptionSets: Map<string, GlobalOptionSet>;
  relationships: AnyRelationship[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Derive a human-readable solution name from a file-system path. */
export function deriveSolutionName(path: string): string {
  return basename(path.replace(/[/\\]+$/, ''));
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Merge multiple solution layers (processed left-to-right, base → most
 * specialised) into a single unified model.
 *
 * Rules:
 *  - Table metadata  : display_name / description → last-wins; ownership →
 *                      first-wins (structural, cannot be overridden)
 *  - Columns         : first-wins per logical name within an entity; new
 *                      columns from later layers are appended and stamped with
 *                      the layer that introduced them
 *  - Local OptionSets: follow their column — first-wins by name
 *  - Global OptionSets: first-wins by name
 *  - Relationships   : first-wins by relationship name (deduplicated)
 *  - source_solution : stamped on every element from its originating layer
 */
export function mergeSolutions(layers: SolutionLayer[]): MergedModel {
  const entities = new Map<string, Entity>();
  const globalOptionSets = new Map<string, GlobalOptionSet>();
  const relationships: AnyRelationship[] = [];
  const seenRelNames = new Set<string>();

  for (const layer of layers) {
    const { name: solutionName } = layer;

    // ── Entities & columns ─────────────────────────────────────────────────
    for (const [entityName, entity] of layer.entities) {
      if (!entities.has(entityName)) {
        // First occurrence — stamp everything and register
        entity.sourceSolution = solutionName;
        for (const attr of entity.attributes) {
          attr.sourceSolution = solutionName;
        }
        for (const os of entity.localOptionSets.values()) {
          os.sourceSolution = solutionName;
        }
        entities.set(entityName, entity);
      } else {
        // Entity already registered — merge incrementally
        const existing = entities.get(entityName)!;

        // display_name and description: last-wins (presentation metadata)
        if (entity.displayName) existing.displayName = entity.displayName;
        if (entity.description) existing.description = entity.description;
        // ownership: first-wins (structural, not overridable)
        // isActivity / isActivityParty: structural, first-wins
        // isAuditEnabled: OR semantics — any layer enabling it counts
        if (entity.isAuditEnabled) existing.isAuditEnabled = true;

        // Merge new columns (first-wins by logical name)
        const existingColNames = new Set(existing.attributes.map((a) => a.name));
        for (const attr of entity.attributes) {
          if (existingColNames.has(attr.name)) continue;

          attr.sourceSolution = solutionName;
          existing.attributes.push(attr);
          existingColNames.add(attr.name);

          // Bring the local OptionSet along if the new column references one
          if (attr.optionSetName && entity.localOptionSets.has(attr.optionSetName)
            && !existing.localOptionSets.has(attr.optionSetName)) {
            const os = entity.localOptionSets.get(attr.optionSetName)!;
            os.sourceSolution = solutionName;
            existing.localOptionSets.set(attr.optionSetName, os);
          }

          // Track global optionset references introduced by new columns
          if (attr.optionSetName && !entity.localOptionSets.has(attr.optionSetName)) {
            existing.globalOptionSetRefs.add(attr.optionSetName);
          }
        }

        // Merge alternate keys (first-wins by key name)
        const existingKeyNames = new Set(existing.keys.map((k) => k.name));
        for (const key of entity.keys) {
          if (!existingKeyNames.has(key.name)) {
            existing.keys.push(key);
            existingKeyNames.add(key.name);
          }
        }
      }
    }

    // ── Global option sets ─────────────────────────────────────────────────
    for (const [osName, os] of layer.globalOptionSets) {
      if (!globalOptionSets.has(osName)) {
        os.sourceSolution = solutionName;
        globalOptionSets.set(osName, os);
      }
    }

    // ── Relationships ──────────────────────────────────────────────────────
    for (const rel of layer.relationships) {
      if (rel.name && seenRelNames.has(rel.name)) continue;
      if (rel.name) seenRelNames.add(rel.name);
      rel.sourceSolution = solutionName;
      relationships.push(rel);
    }
  }

  return { entities, globalOptionSets, relationships };
}
