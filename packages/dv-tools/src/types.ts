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
  sourceType: string;      // simple|calculated|rollup|formula
  autoNumber: string;
  format: string;
  displayName: string;
  description: string;
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

export interface ConvertOptions {
  outputDir: string;
  writeDbml: boolean;
  colors: Record<string, string>;
  solutionNames?: string[];
}
