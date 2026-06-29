export enum ElementKind {
  Table = 'table',
  Enum = 'enum',
  Ref = 'ref',
  Note = 'note',
  Project = 'project',
  Indexes = 'indexes',
  TableGroup = 'tablegroup',
  TablePartial = 'tablepartial',
  Checks = 'checks',
  Records = 'records',
  DiagramView = 'diagramview',
  DiagramViewTables = 'tables',
  DiagramViewNotes = 'notes',
  DiagramViewTableGroups = 'tablegroups',
  DiagramViewSchemas = 'schemas',

  // Dataverse — option set element kinds
  OptionSet = 'optionset',
  StateOptionSet = 'stateoptionset',
  StatusOptionSet = 'statusoptionset',
  BitOptionSet = 'bitoptionset',
}

export enum SettingName {
  Color = 'color',
  HeaderColor = 'headercolor',
  Note = 'note',

  PK = 'pk',
  PrimaryKey = 'primary key',
  Unique = 'unique',
  Ref = 'ref',
  NotNull = 'not null',
  Null = 'null',
  Increment = 'increment',
  Default = 'default',
  Name = 'name',
  Type = 'type',
  Check = 'check',

  Update = 'update',
  Delete = 'delete',
  Inactive = 'inactive',

  // Dataverse — shared
  DisplayName = 'display_name',
  Description = 'description',
  IntroducedVersion = 'introduced_version',

  // Dataverse — table settings
  EntitySetName = 'entity_set_name',
  Ownership = 'ownership',
  PrimaryImage = 'primary_image',
  IsActivity = 'is_activity',
  IsActivityParty = 'is_activity_party',
  IsAuditEnabled = 'is_audit_enabled',
  ChangeTrackingEnabled = 'change_tracking_enabled',
  IsQuickCreateEnabled = 'is_quick_create_enabled',
  IsValidForQueue = 'is_valid_for_queue',
  IsAvailableOffline = 'is_available_offline',

  // Dataverse — column settings
  Required = 'required',
  SourceType = 'source_type',
  Format = 'format',
  AutoNumber = 'auto_number',
  FormulaFile = 'formula_file',
  IsPrimaryName = 'is_primary_name',
  ReadonlyInUI = 'readonly_in_ui',
  MinValue = 'min_value',
  MaxValue = 'max_value',
  Targets = 'targets',
  IsLocalizable = 'is_localizable',
  Precision = 'precision',

  // Dataverse — ref (relationship) settings
  CascadeAssign = 'cascade_assign',
  CascadeArchive = 'cascade_archive',
  CascadeReparent = 'cascade_reparent',
  CascadeShare = 'cascade_share',
  CascadeUnshare = 'cascade_unshare',
  CascadeRollupView = 'cascade_rollupview',
  IsHierarchical = 'is_hierarchical',
  NavMany = 'nav_many',
  NavOne = 'nav_one',
  NavPaneDisplay = 'nav_pane_display',
  NavPaneArea = 'nav_pane_area',
  NavPaneOrder = 'nav_pane_order',
  IntersectEntity = 'intersect_entity',
  NavManyLeft = 'nav_many_left',
  NavManyRight = 'nav_many_right',

  // Dataverse — option set value settings
  Label = 'label',
  InvariantName = 'invariant_name',
  DefaultStatus = 'default_status',
  State = 'state',

  // Dataverse — option set element settings
  IsGlobal = 'is_global',

  // Dataverse — column-to-optionset link
  OptionSetName = 'option_set',

  // Dataverse — provenance (multi-solution)
  SourceSolution = 'source_solution',
}
