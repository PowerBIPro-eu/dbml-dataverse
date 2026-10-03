import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Attribute, Entity, EntityKey, GlobalOptionSet, LocalOptionSet,
  OptionSetValue, StateValue, StatusValue,
} from '../types.js';
import {
  xmlParser, getLabel1033,
  mapOwnership, SOURCE_TYPE_MAP, EXCLUDED_COLUMNS,
} from './utils.js';
import { listDir } from '../util.js';

// ── Global OptionSet parser ────────────────────────────────────────────────

export function parseGlobalOptionSet(filePath: string): GlobalOptionSet | null {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf-8'); } catch { return null; }

  let doc: any;
  try { doc = xmlParser.parse(raw); } catch { return null; }

  // Root element can be <OptionSet> or <optionset>
  const root = doc.OptionSet ?? doc.optionset ?? doc.customLookupOptionSet;
  if (!root) return null;

  const name: string = root['@_Name'] ?? root['@_name'] ?? '';
  if (!name) return null;

  const displayName = getLabel1033(root.displaynames?.displayname, 'description');
  const description = getLabel1033(root.Descriptions?.Description, 'description');

  const values: OptionSetValue[] = [];
  const options = root.options?.option ?? [];
  for (const opt of options) {
    const rawVal = opt['@_value'];
    if (rawVal === undefined || rawVal === null) continue;
    const intVal = parseInt(String(rawVal), 10);
    if (isNaN(intVal)) continue;
    const label = getLabel1033(opt.labels?.label, 'description');
    if (label) values.push({ value: intVal, label });
  }

  if (!values.length) return null;
  return { name, displayName, description, values };
}

// ── Inline OptionSet parser ────────────────────────────────────────────────

function parseInlineOptionSet(osEl: any, fallbackType: string): LocalOptionSet | null {
  const name: string = osEl['@_Name'] ?? osEl['@_name'] ?? '';
  const type = ((osEl.OptionSetType ?? fallbackType) as string).toLowerCase() as LocalOptionSet['type'];
  const displayName = getLabel1033(osEl.displaynames?.displayname, 'description');
  const description = getLabel1033(osEl.Descriptions?.Description, 'description');

  if (type === 'state') {
    const states: StateValue[] = (osEl.states?.state ?? []).map((s: any) => ({
      value: parseInt(String(s['@_value'] ?? '0'), 10),
      label: getLabel1033(s.labels?.label, 'description'),
      invariantName: s['@_invariantname'] ?? '',
      defaultStatus: s['@_defaultstatus'] !== undefined ? parseInt(String(s['@_defaultstatus']), 10) : null,
    }));
    return { name, type: 'state', displayName, description, states };
  }

  if (type === 'status') {
    const statuses: StatusValue[] = (osEl.statuses?.status ?? []).map((s: any) => ({
      value: parseInt(String(s['@_value'] ?? '0'), 10),
      label: getLabel1033(s.labels?.label, 'description'),
      state: s['@_state'] !== undefined ? parseInt(String(s['@_state']), 10) : null,
      color: String(s['@_Color'] ?? ''),
    }));
    return { name, type: 'status', displayName, description, statuses };
  }

  if (type === 'bit') {
    let trueLabel = '', falseLabel = '';
    for (const opt of (osEl.options?.option ?? [])) {
      const label = getLabel1033(opt.labels?.label, 'description');
      if (String(opt['@_value']) === '1') trueLabel = label;
      else if (String(opt['@_value']) === '0') falseLabel = label;
    }
    return { name, type: 'bit', displayName, description, trueLabel, falseLabel };
  }

  // picklist / multiselectpicklist
  const values: OptionSetValue[] = [];
  for (const opt of (osEl.options?.option ?? [])) {
    const rawVal = opt['@_value'];
    if (rawVal === undefined || rawVal === null) continue;
    const intVal = parseInt(String(rawVal), 10);
    if (isNaN(intVal)) continue;
    const label = getLabel1033(opt.labels?.label, 'description');
    if (label) values.push({ value: intVal, label });
  }
  return { name, type: 'picklist', displayName, description, values };
}

// ── Yes/No labels ─────────────────────────────────────────────────────────

const DEFAULT_BIT_LABELS = ['yes', 'no', 'true', 'false'];

/** True when both labels are platform defaults (Python: {tl, fl} <= {'yes', 'no', 'true', 'false'}). */
export function isDefaultBitLabels(trueLabel: string, falseLabel: string): boolean {
  const tl = trueLabel.trim().toLowerCase();
  const fl = falseLabel.trim().toLowerCase();
  return DEFAULT_BIT_LABELS.includes(tl) && DEFAULT_BIT_LABELS.includes(fl);
}

// ── Required level normalizer ─────────────────────────────────────────────

// Dataverse XML stores RequiredLevel as either a string name or a numeric code.
// DBML expects one of the five lowercase string tokens.
type RequiredLevel = 'none' | 'required' | 'applicationrequired' | 'systemrequired' | 'recommended';

function normalizeRequiredLevel(raw: string): RequiredLevel {
  switch (raw.toLowerCase()) {
    case 'none':                case '0': return 'none';
    case 'systemrequired':      case '1': return 'systemrequired';
    case 'applicationrequired': case '2': return 'applicationrequired';
    case 'required':            case '3': return 'required';
    case 'recommended':         case '4': return 'recommended';
    default: return 'none';
  }
}

// ── Entity XML parser ──────────────────────────────────────────────────────

export function parseEntityXml(filePath: string): Entity | null {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf-8'); } catch { return null; }

  let doc: any;
  try { doc = xmlParser.parse(raw); } catch { return null; }

  const entity = doc?.Entity?.EntityInfo?.entity;
  if (!entity) return null;

  const entityName: string = entity['@_Name'] ?? '';
  if (!entityName) return null;
  if (String(entity.IsBPFEntity) === '1') return null;

  // Display name
  const displayName = getLabel1033(entity.LocalizedNames?.LocalizedName, 'description');
  const description = getLabel1033(entity.Descriptions?.Description, 'description');
  const ownership = mapOwnership(String(entity.OwnershipTypeMask ?? ''));
  const isAuditEnabled = String(entity.IsAuditEnabled) === '1';
  const isActivity = String(entity.IsActivity) === '1';
  const isActivityKnown = entity.IsActivity !== undefined;
  const isActivityParty = String(entity.IsActivityParty) === '1';
  const entitySetName = String(entity.EntitySetName ?? '').trim();

  // Attributes
  const localOptionSets = new Map<string, LocalOptionSet>();
  const globalOptionSetRefs = new Set<string>();
  const attributes: Attribute[] = [];

  for (const attr of (entity.attributes?.attribute ?? [])) {
    const logicalName = String(attr.LogicalName ?? attr.Name ?? '').toLowerCase();
    if (!logicalName || EXCLUDED_COLUMNS.has(logicalName)) continue;

    const attrType: string = String(attr.Type ?? '');
    const requiredLevel: RequiredLevel = normalizeRequiredLevel(String(attr.RequiredLevel ?? '0'));
    const sourceType: string = SOURCE_TYPE_MAP[String(attr.SourceType ?? '0')] ?? 'simple';
    const autoNumber: string = String(attr.AutoNumberFormat ?? '').trim();
    const fmt: string = String(attr.Format ?? '').trim();
    const maxLength: string = String(attr.MaxLength ?? '').trim();

    const attrDisplay = getLabel1033(attr.displaynames?.displayname, 'description');
    const attrDesc = getLabel1033(attr.Descriptions?.Description, 'description');

    // Build DBML type string
    let dbmlType = attrType;
    if (attrType === 'nvarchar' && maxLength && maxLength !== '') {
      dbmlType = `nvarchar(${maxLength})`;
    }

    let optionSetName: string | null = null;

    // Inline optionset
    const osEl = attr.optionset;
    if (osEl) {
      const osData = parseInlineOptionSet(osEl, attrType);
      if (osData) {
        const isBit = osData.type === 'bit';
        if (isBit) {
          if (!isDefaultBitLabels(osData.trueLabel ?? '', osData.falseLabel ?? '')) {
            localOptionSets.set(osData.name, osData);
            optionSetName = osData.name;
          }
          // default Yes/No bit: no option_set link, no BitOptionSet block
        } else {
          localOptionSets.set(osData.name, osData);
          optionSetName = osData.name;
        }
      }
    }

    // Global OptionSet reference
    if (optionSetName === null) {
      const globalRef = String(attr.OptionSetName ?? '').trim();
      if (globalRef) {
        optionSetName = globalRef;
        globalOptionSetRefs.add(globalRef);
      }
    }

    attributes.push({
      name: logicalName,
      type: dbmlType,
      required: requiredLevel,
      isPk: attrType === 'primarykey',
      isCustom: String(attr.IsCustomField) === '1',
      sourceType,
      autoNumber,
      format: fmt,
      displayName: attrDisplay,
      description: attrDesc,
      optionSetName,
      lookupTargets: [],
    });
  }

  // Alternate keys
  const keys: EntityKey[] = [];
  for (const keyEl of (entity.EntityKeys?.EntityKey ?? [])) {
    const keyName = String(keyEl.Name ?? '');
    const cols: string[] = (keyEl.EntityKeyAttributes?.AttributeName ?? []).map(String);
    if (cols.length) keys.push({ name: keyName, columns: cols });
  }

  return {
    name: entityName,
    displayName,
    description,
    ownership,
    isAuditEnabled,
    isActivity,
    isActivityParty,
    isActivityKnown,
    entitySetName,
    hasPrimaryKey: attributes.some((a) => a.isPk),
    attributes,
    localOptionSets,
    globalOptionSetRefs,
    keys,
  };
}

// ── Directory scanner ──────────────────────────────────────────────────────

/** Parse all Entity.xml files from an Entities folder, in name order. Returns map of name → Entity. */
export function parseEntitiesFolder(entitiesPath: string): Map<string, Entity> {
  const result = new Map<string, Entity>();
  if (!existsSync(entitiesPath)) return result;

  for (const dir of listDir(entitiesPath, 'dirs')) {
    const entity = parseEntityXml(join(entitiesPath, dir, 'Entity.xml'));
    if (entity) result.set(entity.name, entity);
  }
  return result;
}

/** Parse all OptionSet XML files from an OptionSets folder, in file-name order. */
export function parseOptionSetsFolder(osPath: string): Map<string, GlobalOptionSet> {
  const result = new Map<string, GlobalOptionSet>();
  if (!existsSync(osPath)) return result;

  for (const fn of listDir(osPath, 'files')) {
    if (!fn.endsWith('.xml')) continue;
    const os = parseGlobalOptionSet(join(osPath, fn));
    if (os) result.set(os.name, os);
  }
  return result;
}
