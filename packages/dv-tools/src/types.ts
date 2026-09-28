// ── Shared data types (mirrors the Python dv_converter.py structures) ─────────

export interface OptionSetValue {
  value: number;
  label: string;
  color?: string;
}

export interface StateValue {
  value: number;
  label: string;
  invariantName: string;
  defaultStatus: number | null;
}

export interface StatusValue {
  value: number;
  label: string;
  state: number | null;
  color: string;
}

export type LocalOptionSetType = 'picklist' | 'state' | 'status' | 'bit';

export interface LocalOptionSet {
  name: string;
  type: LocalOptionSetType;
  displayName: string;
  description: string;
  sourceSolution?: string;
  // picklist
  values?: OptionSetValue[];
  // state
  states?: StateValue[];
  // status
  statuses?: StatusValue[];
  // bit (custom labels only)
  trueLabel?: string;
  falseLabel?: string;
}

export interface GlobalOptionSet {
  name: string;
  displayName: string;
  description: string;
  values: OptionSetValue[];
  sourceSolution?: string;
}

export interface Attribute {
  name: string;            // logical name (lowercase)
  type: string;            // DBML type string e.g. "nvarchar(250)", "picklist"
  required: string;        // none|required|applicationrequired|systemrequired
  isPk: boolean;
  isCustom: boolean;       // IsCustomField == 1 (created by us)
  sourceType: string;      // simple|calculated|rollup|formula
  autoNumber: string;
  format: string;
  displayName: string;
  description: string;     // as in the XML (character references not decoded)
  optionSetName: string | null;
  lookupTargets: string[]; // filled in second pass from relationships
  sourceSolution?: string;
}

export interface EntityKey {
  name: string;
  columns: string[];
}

export interface Entity {
  name: string;
  displayName: string;
  description: string;
  ownership: string;
  isAuditEnabled: boolean;
  isActivity: boolean;
  isActivityParty: boolean;
  /** IsActivity is present in the XML (partial platform tables often omit entity metadata). */
  isActivityKnown: boolean;
  /** The XML defines the primary-key attribute, i.e. the full table (not only some columns). */
  hasPrimaryKey: boolean;
  attributes: Attribute[];
  localOptionSets: Map<string, LocalOptionSet>;
  globalOptionSetRefs: Set<string>;
  keys: EntityKey[];
  sourceSolution?: string;
}

export interface Relationship {
  type: 'OneToMany';
  name: string;
  referenced: string;
  referencing: string;
  fkCol: string;
  cascades: Record<string, string>;  // e.g. { delete: 'Cascade', cascade_assign: 'NoCascade' }
  isHierarchical: boolean;
  navMany: string;
  navOne: string;
  navPaneDisplay: string;
  navPaneArea: string;
  navPaneOrder: number | null;
  sourceSolution?: string;
}

export interface ManyToManyRelationship {
  type: 'ManyToMany';
  name: string;
  first: string;
  second: string;
  intersect: string;
  sourceSolution?: string;
}

export type AnyRelationship = Relationship | ManyToManyRelationship;

/** Which platform (non-publisher) tables end up in the model. */
export type PlatformTables = 'with-our-columns' | 'all' | 'none';

export const PLATFORM_TABLES_VALUES: readonly PlatformTables[] = ['with-our-columns', 'all', 'none'];

/** Solution.xml facts; null when the solution folder has no Solution.xml. */
export interface SolutionInfo {
  uniqueName: string | null;
  displayName: string | null;
  version: string | null;
  publisher: {
    uniqueName: string | null;
    customizationPrefix: string | null;
    optionValuePrefix: number | null;
  } | null;
}

export interface SolutionInput {
  path: string;          // absolute solution folder
  name: string;          // friendly name (source_solution)
  uniqueName?: string;   // expected Solution.xml UniqueName (options file)
}

export interface ConvertOptions {
  solutions: SolutionInput[];
  outputDir: string;           // absolute
  writeDbml: boolean;
  colors: Record<string, string>;
  platformTables: PlatformTables;
  configPath: string | null;   // absolute path of the options file, recorded in provenance
}
