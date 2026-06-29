import { XMLParser } from 'fast-xml-parser';

// Tags that must always be arrays (even when only one element appears)
const FORCE_ARRAY = new Set([
  'attribute', 'displayname', 'LocalizedName', 'LocalizedCollectionName',
  'Description', 'EntityRelationship', 'EntityRelationshipRole',
  'option', 'state', 'status', 'label', 'EntityKey', 'AttributeName',
]);

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name: string) => FORCE_ARRAY.has(name),
});

// ── Attribute helpers ──────────────────────────────────────────────────────

/** Get English (1033) description from a parsed labels/displaynames/Descriptions array. */
export function getLabel1033(items: any[] | undefined, descKey = 'description'): string {
  if (!items) return '';
  const found = items.find((i: any) => i['@_languagecode'] === '1033');
  return found ? (found[`@_${descKey}`] as string ?? '') : '';
}

/** Get display name from displaynames element. */
export function getDisplayName(el: any): string {
  return getLabel1033(el?.displaynames?.displayname, 'description');
}

/** Get description from Descriptions element. */
export function getDescription(el: any): string {
  return getLabel1033(el?.Descriptions?.Description, 'description');
}

/** Map Dataverse OwnershipTypeMask to our ownership enum string. */
export function mapOwnership(raw: string): string {
  const r = (raw ?? '').trim().toLowerCase();
  if (['userowned', '2', '3'].includes(r)) return 'UserOwned';
  if (['teamowned', '8'].includes(r)) return 'TeamOwned';
  if (['organizationowned', 'orgowned', '4', '6'].includes(r)) return 'OrganizationOwned';
  return 'None';
}

/** Map SourceType integer to DBML source_type string. */
export const SOURCE_TYPE_MAP: Record<string, string> = {
  '0': 'simple', '1': 'calculated', '2': 'rollup', '4': 'formula',
};

/** Columns to always exclude (audit, system, owner). */
export const EXCLUDED_COLUMNS = new Set([
  'timezoneruleversionnumber', 'utcconversiontimezonecode',
  'importsequencenumber', 'overriddencreatedon', 'processid',
  'stageid', 'traversedpath', 'versionnumber', 'organizationid',
  'createdby', 'createdon', 'createdonbehalfby',
  'modifiedby', 'modifiedon', 'modifiedonbehalfby',
  'ownerid', 'owningteam', 'owninguser',
]);

/** Entity names to always exclude. */
export const EXCLUDED_ENTITIES = new Set([
  'BusinessUnit', 'Role', 'SystemUser', 'Team', 'TransactionCurrency',
]);

/** Cascade action XML tags → DBML setting keys. */
export const CASCADE_ACTIONS: Array<[string, string]> = [
  ['CascadeDelete',    'delete'],
  ['CascadeAssign',    'cascade_assign'],
  ['CascadeArchive',   'cascade_archive'],
  ['CascadeReparent',  'cascade_reparent'],
  ['CascadeShare',     'cascade_share'],
  ['CascadeUnshare',   'cascade_unshare'],
  ['CascadeRollupView','cascade_rollupview'],
];
