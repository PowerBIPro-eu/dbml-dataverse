import type {
  AnyRelationship, Entity, GlobalOptionSet, LocalOptionSet,
  Relationship, ManyToManyRelationship,
} from '../types.js';

// ── String helpers ─────────────────────────────────────────────────────────

function q(s: string): string {
  return (s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── OptionSet block emitters ───────────────────────────────────────────────

export function emitOptionSet(
  name: string, displayName: string, description: string,
  values: Array<{ value: number; label: string; color?: string }>,
  isGlobal = false,
  sourceSolution?: string,
): string {
  const parts: string[] = [];
  if (displayName) parts.push(`display_name: '${q(displayName)}'`);
  if (isGlobal) parts.push('is_global: true');
  if (description) parts.push(`description: '${q(description)}'`);
  if (sourceSolution) parts.push(`source_solution: '${q(sourceSolution)}'`);
  const bracket = parts.length ? ` [${parts.join(', ')}]` : '';
  const lines = [`OptionSet ${name}${bracket} {`];
  for (const { value, label, color } of values) {
    const vParts = [`label: '${q(label)}'`];
    if (color) vParts.push(`color: '${color}'`);
    lines.push(`  ${value} [${vParts.join(', ')}]`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function emitStateOptionSet(
  name: string,
  states: Array<{ value: number; label: string; invariantName: string; defaultStatus: number | null }>,
): string {
  const lines = [`StateOptionSet ${name} {`];
  for (const { value, label, invariantName, defaultStatus } of states) {
    const parts = [`label: '${q(label)}'`];
    if (invariantName) parts.push(`invariant_name: '${q(invariantName)}'`);
    if (defaultStatus !== null) parts.push(`default_status: ${defaultStatus}`);
    lines.push(`  ${value} [${parts.join(', ')}]`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function emitStatusOptionSet(
  name: string,
  statuses: Array<{ value: number; label: string; state: number | null; color: string }>,
): string {
  const lines = [`StatusOptionSet ${name} {`];
  for (const { value, label, state, color } of statuses) {
    const parts = [`label: '${q(label)}'`];
    if (state !== null) parts.push(`state: ${state}`);
    if (color) parts.push(`color: '${color}'`);
    lines.push(`  ${value} [${parts.join(', ')}]`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function emitBitOptionSet(name: string, trueLabel: string, falseLabel: string): string {
  return [
    `BitOptionSet ${name} {`,
    `  1 [label: '${q(trueLabel)}']`,
    `  0 [label: '${q(falseLabel)}']`,
    '}', '',
  ].join('\n');
}

// ── Local OptionSet emitter ────────────────────────────────────────────────

export function emitLocalOptionSet(os: LocalOptionSet): string {
  switch (os.type) {
    case 'state':
      return emitStateOptionSet(os.name, os.states!);
    case 'status':
      return emitStatusOptionSet(os.name, os.statuses!);
    case 'bit':
      return emitBitOptionSet(os.name, os.trueLabel!, os.falseLabel!);
    default:
      return emitOptionSet(os.name, os.displayName, os.description, os.values!, false, os.sourceSolution);
  }
}

// ── Table emitter ──────────────────────────────────────────────────────────

export function emitTable(
  entity: Entity,
  pkMap: Map<string, string>,
  headerColor: string | undefined,
): string {
  const tableSettings: string[] = [];
  if (entity.displayName) tableSettings.push(`display_name: '${q(entity.displayName)}'`);
  if (entity.ownership && entity.ownership !== 'None') tableSettings.push(`ownership: ${entity.ownership}`);
  if (entity.isAuditEnabled) tableSettings.push('is_audit_enabled: true');
  if (entity.isActivity) tableSettings.push('is_activity: true');
  if (entity.isActivityParty) tableSettings.push('is_activity_party: true');
  if (entity.description) tableSettings.push(`description: '${q(entity.description)}'`);
  if (entity.sourceSolution) tableSettings.push(`source_solution: '${q(entity.sourceSolution)}'`);
  tableSettings.push(`headercolor: ${headerColor ?? '#175e7a'}`);

  const bracket = ` [${tableSettings.join(', ')}]`;
  const lines = [`Table ${entity.name}${bracket} {`];

  for (const attr of entity.attributes) {
    const colSettings: string[] = [];
    if (attr.isPk) colSettings.push('pk');
    if (attr.displayName) colSettings.push(`display_name: '${q(attr.displayName)}'`);
    colSettings.push(`required: ${attr.required}`);
    if (attr.sourceType !== 'simple') colSettings.push(`source_type: ${attr.sourceType}`);
    if (attr.autoNumber) colSettings.push(`auto_number: '${q(attr.autoNumber)}'`);
    if (attr.format) colSettings.push(`format: '${attr.format}'`);
    if (attr.optionSetName) colSettings.push(`option_set: '${attr.optionSetName}'`);
    if (attr.lookupTargets.length) colSettings.push(`targets: '${attr.lookupTargets.join(', ')}'`);
    const desc = attr.description;
    if (desc && !desc.includes('\n') && desc.length <= 100) {
      colSettings.push(`note: '${q(desc)}'`);
    }
    if (attr.sourceSolution) colSettings.push(`source_solution: '${q(attr.sourceSolution)}'`);
    const settings = colSettings.length ? ` [${colSettings.join(', ')}]` : '';
    lines.push(`  ${attr.name} ${attr.type}${settings}`);
  }

  if (entity.keys.length) {
    lines.push('', '  indexes {');
    for (const key of entity.keys) {
      lines.push(`    (${key.columns.join(', ')}) [name: '${key.name}', unique]`);
    }
    lines.push('  }');
  }

  lines.push('}', '');
  return lines.join('\n');
}

// ── Ref emitters ───────────────────────────────────────────────────────────

export function emitRef(rel: AnyRelationship, pkMap: Map<string, string>): string {
  if (rel.type === 'ManyToMany') {
    const mn = rel as ManyToManyRelationship;
    const pkFirst = pkMap.get(mn.first) ?? `${mn.first.toLowerCase()}id`;
    const pkSecond = pkMap.get(mn.second) ?? `${mn.second.toLowerCase()}id`;
    const relName = mn.name || `${mn.first}_${mn.second}`;
    const lines = [`Ref ${relName} [`];
    if (mn.intersect) lines.push(`  intersect_entity: '${mn.intersect}'`);
    if (mn.sourceSolution) lines.push(`  source_solution: '${q(mn.sourceSolution)}'`);
    // Remove trailing comma if only one setting
    if (lines.length === 2) {
      lines[1] = lines[1];
      lines.push(`]: ${mn.first}.${pkFirst} <> ${mn.second}.${pkSecond}`);
    } else {
      lines.push(`]: ${mn.first}.${pkFirst} <> ${mn.second}.${pkSecond}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const r = rel as Relationship;
  const pkCol = pkMap.get(r.referenced) ?? `${r.referenced.toLowerCase()}id`;

  const settingLines: string[] = [];
  const { cascades } = r;
  if (cascades['delete']) settingLines.push(`  delete: ${cascades['delete']}`);
  for (const [, key] of [['CascadeAssign', 'cascade_assign'], ['CascadeArchive', 'cascade_archive'],
    ['CascadeReparent', 'cascade_reparent'], ['CascadeShare', 'cascade_share'],
    ['CascadeUnshare', 'cascade_unshare'], ['CascadeRollupView', 'cascade_rollupview']]) {
    if (cascades[key]) settingLines.push(`  ${key}: ${cascades[key]}`);
  }
  if (r.isHierarchical) settingLines.push('  is_hierarchical: true');
  if (r.navMany) settingLines.push(`  nav_many: '${r.navMany}'`);
  if (r.navOne) settingLines.push(`  nav_one: '${r.navOne}'`);
  if (r.navPaneDisplay) settingLines.push(`  nav_pane_display: ${r.navPaneDisplay}`);
  if (r.navPaneArea) settingLines.push(`  nav_pane_area: ${r.navPaneArea}`);
  if (r.navPaneOrder !== null) settingLines.push(`  nav_pane_order: ${r.navPaneOrder}`);
  if (r.sourceSolution) settingLines.push(`  source_solution: '${q(r.sourceSolution)}'`);

  const endpoint = `${r.referenced}.${pkCol} < ${r.referencing}.${r.fkCol}`;
  if (!settingLines.length) {
    return `Ref ${r.name}: ${endpoint}\n\n`;
  }

  const lines = [`Ref ${r.name} [`];
  for (let i = 0; i < settingLines.length; i++) {
    lines.push(settingLines[i] + (i < settingLines.length - 1 ? ',' : ''));
  }
  lines.push(`]: ${endpoint}`, '');
  return lines.join('\n');
}

// ── Full entity file emitter ───────────────────────────────────────────────

export function emitEntityFile(
  entity: Entity,
  pkMap: Map<string, string>,
  headerColor: string | undefined,
  rels: AnyRelationship[],
): string {
  const parts: string[] = [
    `// Generated from Dataverse solution XML`,
    `// Entity: ${entity.name}`,
    '',
  ];

  for (const os of entity.localOptionSets.values()) {
    parts.push(emitLocalOptionSet(os));
  }

  parts.push(emitTable(entity, pkMap, headerColor));

  for (const rel of rels) {
    parts.push(emitRef(rel, pkMap));
  }

  return parts.join('\n');
}

/** Emit all global option sets into one .dv.dbml string. */
export function emitGlobalOptionSetsFile(globalOptionSets: Map<string, GlobalOptionSet>): string {
  const parts = [
    '// Global option sets (solution-level, shared across entities)',
    '',
  ];
  for (const os of globalOptionSets.values()) {
    parts.push(emitOptionSet(os.name, os.displayName, os.description, os.values, true, os.sourceSolution));
  }
  return parts.join('\n');
}
