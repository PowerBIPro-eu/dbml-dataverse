# dv-tools — Dataverse → DBML Converter

Converts Power Platform / Dataverse solution XML into `.dv.dbml` and `model.json` files, plus
`components.json` with the solution's plugins, cloud flows and processes. Supports layered
ALM — pass multiple solution paths and every element gets stamped with `source_solution` so
you know which module introduced each table, column, relationship or component.

The output is deterministic: the same solution XML gives byte-identical files on Windows,
macOS and Linux, so regenerated files only change when the model changes.

---

## Installation

Requires **Node.js ≥ 18** and a GitHub account that is a member of the **PowerBIPro-eu** org.

### Step 1 — authenticate to GitHub Packages (once per machine)

1. Go to <https://github.com/settings/tokens> → **Generate new token (classic)**
2. Give it a name (e.g. `npm-read`) and tick only the **`read:packages`** scope
3. Add this line to your user-level `~/.npmrc` (create the file if it doesn't exist):

```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN_HERE
```

> **Windows:** the file lives at `C:\Users\<YourName>\.npmrc`

### Step 2 — install the CLI globally

```bash
npm install -g @powerbipro-eu/dv-tools --registry=https://npm.pkg.github.com
```

Verify it installed correctly (prints the installed version):

```bash
dv-convert --version
```

---

## Quick start

```bash
# Single solution
dv-convert ./MySolution --output ./datamodel

# Multiple layered solutions — pass in dependency order (base layer first)
dv-convert ./CoreSolution ./SalesModule ./ServiceModule --output ./datamodel

# Give the solutions friendlier names in the output metadata
dv-convert ./CoreSolution ./SalesModule --output ./datamodel --solution-names Core,Sales

# Custom diagram header colors per table
dv-convert ./MySolution --output ./datamodel --colors colors.json
```

### With an options file (recommended in a solution repository)

Record the solutions once, then run `dv-convert` without arguments:

```bash
# writes docs/datamodel/dv-convert.json, then converts
dv-convert ./Solutions/Core ./Solutions/Sales --output docs/datamodel --solution-names Core,Sales --write-config

# later, from anywhere in the repository
dv-convert           # regenerate
dv-convert --check   # exit 1 if docs/datamodel is out of date
```

---

## What gets generated

Running against a solution writes one file per table plus a global option sets file:

```
datamodel/
  global_option_sets.dv.dbml   ← shared picklists
  Account.dv.dbml              ← named after the table as in the solution XML
  ddsol_project.dv.dbml
  ...
  model.json                   ← full parsed model (consumed by diagram tools)
  components.json              ← plugin steps, custom APIs, cloud flows, processes
```

Each `.dv.dbml` file looks like this:

```dbml
Table account [display_name: 'Account', ownership: UserOwned, source_solution: 'Core'] {
  accountid     uniqueidentifier [pk, required: systemrequired, source_solution: 'Core']
  name          nvarchar(160)    [display_name: 'Account Name', required: none, source_solution: 'Core']
  dds_segment   picklist         [required: none, option_set: 'dds_segment', source_solution: 'Sales']
}

Ref account_contacts [
  nav_many: 'contact_customer_accounts',
  source_solution: 'Core'
]: account.accountid < contact.parentcustomerid
```

How the output folder is written:

- dv-convert owns only `*.dv.dbml`, `components.json` and `model.json`. It never touches
  `layout.json`, `dv-convert.json`, `colors.json` or any other file.
- Everything is built and validated in memory first. If the DBML does not compile, nothing
  is written and the folder stays as it was (exit code 3).
- Changed files are written to `<output>/.dv-convert.tmp/` and renamed into place,
  `model.json` last; unchanged files are left alone.
- `.dv.dbml` files that are no longer produced (a table removed from the solution) are
  deleted — except with `--no-dbml` and in single-entity mode. `--no-components` leaves an
  existing `components.json` alone; single-entity mode writes none.
- Files use LF line endings and end with a newline. `--check` ignores line-ending-only
  differences (Windows checkouts with `core.autocrlf`).

---

## Full CLI reference

```
dv-convert [options]                                  (uses dv-convert.json, see below)
dv-convert --config <file> [options]
dv-convert <solution-path> [solution-path ...] --output <dir> [options]
dv-convert <Entity.xml>    --output <dir>             (single entity, debug mode)

Options:
  --output, -o <dir>           Output directory (required with solution paths)
  --config <file>              Options file; cannot be combined with solution paths
  --write-config               Write <output>/dv-convert.json for these paths, then convert
  --check                      Compare with the output folder and write nothing (exit 1 if stale)
  --colors <file>              JSON file mapping table names to hex header colors
  --solution-names <n1,n2,...> Override solution names (comma-separated, in order)
  --platform-tables <mode>     with-our-columns (default), all or none
  --no-dbml                    Skip writing .dv.dbml files
  --no-components              Skip writing components.json (plugins, flows, processes)
  --plugins <dir>              Plugins/ folder whose C# pipelines go into components.json
  --version                    Print the dv-tools version and exit
  --help, -h                   Show this help
```

**Exit codes:** `0` ok · `1` `--check` found stale output · `2` usage or options-file error
(unknown key, newer `configVersion`, invalid JSON, a solution or Plugins folder that does not
exist, a `uniqueName` that does not match `Solution.xml`) · `3` the model could not be built
(DBML error).

### Options file `dv-convert.json`

```json
{
  "configVersion": 1,
  "solutions": [
    { "path": "../../Solutions/Core", "name": "Core", "uniqueName": "DDSolCore" },
    { "path": "../../Solutions/Sales", "name": "Sales" }
  ],
  "output": ".",
  "colors": "colors.json",
  "dbml": true,
  "platformTables": "with-our-columns",
  "plugins": "../../Plugins"
}
```

| Key | Meaning |
|---|---|
| `configVersion` | Required, `1`. A newer version fails with exit code 2 (upgrade dv-tools). |
| `solutions` | Required. Base layer first. `path` is relative to the options file; `name` is the friendly name (default: the folder name); optional `uniqueName` must match the solution's `Solution.xml`, otherwise the run fails. |
| `output` | Output folder, relative to the options file. Default `.`. |
| `colors` | colors.json, relative to the options file. Optional. |
| `dbml` | Write `.dv.dbml` files. Default `true`. |
| `platformTables` | See [Platform tables](#platform-tables). Default `with-our-columns`. |
| `plugins` | The `Plugins/` folder with the plug-in C# code, relative to the options file. Optional: without it, `components.json` has no [pipelines](#pipelines). dv-tools before 1.4.0 rejects this key. |

- Unknown keys are an error (exit code 2), so typos do not go unnoticed.
- Without solution paths or `--config`, dv-convert uses `./dv-convert.json`, otherwise
  `<git root>/docs/datamodel/dv-convert.json`.
- Command-line flags override the file's values (`--output`, `--colors`, `--no-dbml`,
  `--platform-tables`, `--solution-names`, `--plugins`).
- `--write-config` writes the file into the `--output` folder with paths relative to it and
  each solution's `uniqueName` from its `Solution.xml`.

### colors.json format

```json
{
  "account":     "#1a73e8",
  "contact":     "#e53935",
  "opportunity": "#43a047"
}
```

Keys are table names and are matched case-insensitively (`account` and `Account` both work).

---

## model.json

`model.json` is the DBML parser's model with Dataverse facts added. Schema 2 (dv-tools 1.1)
only adds to schema 1 (dv-tools 1.0.x): table, file and relationship names never change, so
diagram layouts that key on them keep working.

```json
{
  "modelSchema": 2,
  "provenance": {
    "generator": { "name": "@powerbipro-eu/dv-tools", "version": "1.1.0" },
    "config": "dv-convert.json",
    "layers": [
      { "order": 1, "name": "Core", "path": "../../Solutions/Core", "uniqueName": "DDSolCore",
        "displayName": "DDSol Core", "version": "1.0.0.22",
        "publisher": { "uniqueName": "ddsol", "customizationPrefix": "ddsol", "optionValuePrefix": 71717 } }
    ]
  },
  "tables": [ ... ],
  "refs": [ ... ],
  "optionSets": [ ... ], "stateOptionSets": [ ... ], "statusOptionSets": [ ... ], "bitOptionSets": [ ... ]
}
```

**Provenance** has no timestamps. `config` and each layer's `path` are relative to the folder
that holds `model.json` (`config` is `null` without an options file). `uniqueName`,
`displayName`, `version` and `publisher` come from each solution's `Solution.xml` and are
`null` when it has none.

**Order:** tables by `logicalName`, then `name`; refs, option sets and indexes by name.
Columns and option values keep the order of the solution XML. Parser positions (`token`,
`filepath`) are not included.

**Added facts:**

| Where | Field | Meaning |
|---|---|---|
| table | `logicalName` | Lowercase table name. |
| table | `isCustom` | The name starts with the publisher prefix of one of the solutions (`ddsol_`). |
| table | `isPartial` | `true` for a platform table whose XML only has some columns (see below). Omitted otherwise. |
| column | `isCustom` | `IsCustomField` is 1: we created the column. The primary key of our own table is platform-made (`false`). |
| column | `description` | The full description (character references such as `&#xA;` decoded). `note` keeps the 1.0.x value: the description only when it is at most 100 characters and single-line. |
| column | `isModified`, `modifications` | A platform column we changed: `statuscode` with our status reasons gives `["statusReasons"]`. Omitted when not modified. |
| state value | `defaultStatus` | The state's default status reason. |
| status value | `state` | The state the status reason belongs to. |
| status value | `isCustom` | `true` on status reasons we added. Omitted otherwise. |
| Yes/No option set | `values` | `[{value: 1, label: trueLabel}, {value: 0, label: falseLabel}]`, next to `trueLabel` / `falseLabel`. |
| column | `targets` | Lookup targets from every relationship in the solution, also tables outside the model (`BusinessUnit`). |

**Many-to-many:** DBML allows one `Ref` per pair of tables. When two N:N relationships join
the same tables (or a table is related to itself), the others are written to `model.json`
only, in the same shape, and noted in a comment in the `.dv.dbml` file.

**Status reasons.** A status reason is ours when it is not part of the platform's set:

- tables we created: statuses `1, 2` (activities: `1–4`) with default statuses `0→1, 1→2`
  (activities `0→1 … 3→4`). Added values, removed values and a changed default status mark
  `statuscode` as modified.
- platform tables ship their own status reasons (Task: 2–7), so there a value is ours when it
  has 9 digits: custom option values start with the publisher's 5-digit option-value prefix.

### Platform tables

A solution often contains only the columns we added to a platform table (e.g. `Task` with
our columns), without the table's primary key. `platformTables` decides what happens:

| Mode | Platform tables in the model |
|---|---|
| `with-our-columns` (default) | Fully defined platform tables (as in 1.0.x), plus platform tables that carry our columns or our status reasons, marked `isPartial`. |
| `all` | Every table in the solution XML, including partial ones without our columns. |
| `none` | None: only tables with our publisher prefix. |

A partial table gets its primary key: `activityid` for activity tables (`IsActivity`, or the
standard activity tables when the XML does not say), otherwise `<logical name>id`. The system
tables `BusinessUnit`, `Role`, `SystemUser`, `Team` and `TransactionCurrency` only appear when
they carry our columns (or with `all`).

---

## components.json

The solution's components outside the data model, read from the same solution folders (every
layer) and written in the same run as `model.json`: plugin assemblies, plugin types and their
steps, custom APIs, cloud flows, business process flows and classic workflows; with a `plugins`
folder, also the [pipelines](#pipelines) of the plug-in code. `--no-components` skips it.

```json
{
  "componentsSchema": 1,
  "provenance": { "generator": { ... }, "config": "dv-convert.json", "layers": [ ... ] },
  "pluginAssemblies": [
    { "id": "d7a5e000-…-000000000001", "name": "Dvt.Plugins", "version": "1.0.0.0",
      "file": "src/PluginAssemblies/DvtPlugins-…/DvtPlugins.dll.data.xml", "sourceSolution": "Core" }
  ],
  "pluginTypes": [
    { "id": "d7a5e000-…-000000000101", "name": "Dvt.Plugins.Project.ValidateBudget", "assembly": "Dvt.Plugins",
      "kind": "plugin", "file": "src/PluginAssemblies/…", "sourceSolution": "Core" }
  ],
  "pluginSteps": [
    { "id": "d7a5e000-…-000000000201", "name": "Dvt.Plugins.Project.ValidateBudget: Update of dvt_project",
      "handlerKind": "plugin",
      "pluginType": "Dvt.Plugins.Project.ValidateBudget", "pluginTypeId": "d7a5e000-…-000000000101", "assembly": "Dvt.Plugins",
      "serviceEndpoint": null,
      "message": "Update", "messageId": "20bebb1b-ea3e-db11-86a7-000a3a5473e8", "primaryEntity": "dvt_project",
      "stage": 20, "stageName": "preOperation", "mode": "sync", "rank": 1,
      "filteringAttributes": ["dvt_accountid", "dvt_budget"],
      "images": [ { "name": "PreImage", "alias": "PreImage", "type": "pre", "attributes": ["dvt_accountid", "dvt_budget"] } ],
      "file": "src/SdkMessageProcessingSteps/{d7a5e000-…-000000000201}.xml", "sourceSolution": "Core" }
  ],
  "customApis": [
    { "uniqueName": "dvt_CalculateBudget", "displayName": "Calculate budget", "description": "Calculates the budget of a project",
      "bindingType": "global", "boundEntity": null, "isFunction": true, "isPrivate": false,
      "allowedCustomProcessingStepType": "none", "executePrivilegeName": null,
      "pluginType": "Dvt.Plugins.Api.CalculateBudget", "pluginTypeId": "d7a5e000-…-000000000106", "assembly": "Dvt.Plugins",
      "requestParameters": [ { "uniqueName": "ProjectId", "type": "guid", "isOptional": false, "entity": null } ],
      "responseProperties": [ { "uniqueName": "Project", "type": "entityReference", "entity": "dvt_project" } ],
      "file": "src/customapis/dvt_CalculateBudget/customapi.xml", "sourceSolution": "Core" }
  ],
  "cloudFlows": [
    { "id": "d7a5e000-…-000000000401", "name": "Notify the project owner",
      "trigger": { "name": "When_a_project_changes", "kind": "dataverse", "connector": "shared_commondataserviceforapps",
                   "operation": "SubscribeWebhookTrigger", "entity": "dvt_project", "messages": ["Update"],
                   "scope": "organization", "filteringAttributes": ["dvt_budget"], "filterExpression": "statecode eq 0" },
      "connectionReferences": [ { "name": "shared_commondataserviceforapps", "logicalName": "dvt_dataverse",
                                  "connector": "shared_commondataserviceforapps" } ],
      "dataverseActions": [ { "name": "Get_the_customer", "operation": "GetItem", "entity": "account",
                              "entitySetName": "accounts", "actionName": null } ],
      "file": "src/Workflows/Notifytheprojectowner-….json", "sourceSolution": "Core" }
  ],
  "businessProcessFlows": [
    { "id": "d7a5e000-…-000000000501", "name": "Project lifecycle", "uniqueName": "dvt_projectlifecycle",
      "primaryEntity": "dvt_project",
      "stages": [ { "id": "d7a5e000-…-000000000512", "name": "Deliver", "order": 2, "category": 1,
                    "entity": "dvt_project", "nextStage": "d7a5e000-…-000000000513",
                    "branches": [ { "condition": "If the project was stopped", "nextStage": "d7a5e000-…-000000000514" } ] } ],
      "file": "src/Workflows/Projectlifecycle-….xaml", "sourceSolution": "Core" }
  ],
  "classicWorkflows": [
    { "id": "d7a5e000-…-000000000605", "name": "Lock the budget on the summary form", "category": "businessRule",
      "primaryEntity": "dvt_project", "scope": "form", "forms": ["d7a5e000-…-000000000701"],
      "file": "src/Workflows/Lockthebudgetonthesummaryform-….xaml", "sourceSolution": "Core" }
  ],
  "pipelines": [ … ]
}
```

- **Every key is always present:** `null` when a value is unknown or does not apply, `[]` for an
  empty list. Ids are GUIDs in lowercase without braces; tables are logical names.
- **Order:** every list by `name`, then `id`; custom APIs, their request parameters and
  response properties by `uniqueName`; column lists sorted; stages in process order. The
  format rules of `model.json` apply (LF, trailing newline, no timestamps).
- **`sourceSolution`** is the layer the component comes from. A component that is in several
  layers (same id; for a custom API, the same unique name) is taken from the first one, as
  columns are.
- **`file`** is the component's definition file, relative to the layer's `path` in
  `provenance`: the step or assembly XML, a custom API's `customapi.xml`, a flow's `.json`, a
  process's `.xaml` (its `.data.xml` when the definition is not in the solution folder).

| Where | Field | Meaning |
|---|---|---|
| plugin type | `name`, `kind` | The full type name (from the assembly-qualified name); `plugin`, or `workflowActivity` for a custom workflow activity. |
| plugin step | `handlerKind` | What the step runs: `plugin` (a plug-in type, `EventHandlerTypeCode` 4602), `webhook` (a service endpoint with contract 8 in `PluginAssemblies/ServiceEndpoints.xml`) or `serviceEndpoint` (any other service endpoint, 4618, and one that is not in the solution). |
| plugin step | `serviceEndpoint` | For webhook and service endpoint steps: `{ id, name }` of the endpoint (`name` is `null` when it is not in the solution); `null` for plug-ins. |
| plugin step | `pluginType`, `assembly` | Plug-in steps only (`null` for the others). From the step's assembly-qualified `PluginTypeName`, else from its plugin type id, else the type from the step name. A step of a plugin package names its type only by an export key, so its `assembly` is `null`; plugin packages themselves are not read. |
| plugin step | `message` | The SDK message: by `messageId` for the 14 platform messages Microsoft Learn lists (Create, Update, Delete, Assign, Retrieve, RetrieveMultiple, SetState, …), else from the step name `<type>: <Message> of <table>`. `null` when neither names it. |
| plugin step | `primaryEntity` | The table the step is registered on; `null` for a message without a table (an event registration, e.g. on a custom API or action). |
| plugin step | `stage`, `stageName` | `10` `preValidation`, `20` `preOperation`, `30` `mainOperation`, `40` `postOperation`. |
| plugin step | `mode` | `sync` or `async`. |
| plugin step | `filteringAttributes` | Columns that trigger an Update step; empty: every column. |
| step image | `type`, `alias`, `attributes` | `pre`, `post` or `both`; the alias the plugin reads the image by; empty `attributes`: all columns. |
| custom API | `displayName`, `description` | The English label, else the default. |
| custom API | `bindingType`, `boundEntity` | `global`, `entity` or `entityCollection`, and the bound table (`null` when global). |
| custom API | `isFunction`, `isPrivate`, `allowedCustomProcessingStepType`, `executePrivilegeName` | As defined; the step type is `none`, `asyncOnly` or `syncAndAsync`. |
| custom API | `pluginType`, `pluginTypeId`, `assembly` | The implementing plug-in type, resolved like a step's: `customapi.xml` names it by id or by export key (for a type in the solution's `PluginAssemblies`, the export key is its id). A type that is not in the solution (e.g. of a plug-in package) keeps only `pluginTypeId`. |
| custom API | `requestParameters`, `responseProperties` | Each with `uniqueName`, `type` (`boolean`, `dateTime`, `decimal`, `entity`, `entityCollection`, `entityReference`, `float`, `integer`, `money`, `picklist`, `string`, `stringArray`, `guid`) and `entity` (the logical entity name); parameters also `isOptional`. |
| cloud flow | `trigger.kind` | `dataverse` (a Dataverse trigger), `connector` (another connector), `manual`, `powerApps`, `copilot` (Copilot Studio), `powerPages`, `http`, `recurrence` or `other`. "When a row is added, modified or deleted" also gives `entity`, `messages` (`Create`, `Update`, `Delete`), `scope` (`user`, `businessUnit`, `parentChildBusinessUnits`, `organization`), `filteringAttributes` and `filterExpression`; "When an action is performed" gives the action as `messages`. |
| cloud flow | `connectionReferences` | The connections the flow uses: the key its actions name, the connection reference's logical name and the connector. |
| cloud flow | `dataverseActions` | Every Dataverse action, nested ones included: `operation` (e.g. `ListRecords`), the table (`entity`, from the entity set name when that table is in the solution; `entitySetName` is `null` when the flow computes it) and `actionName` for bound and unbound actions. |
| business process flow | `uniqueName`, `stages` | The table that holds the process instances; each stage with its position (`order`, from 1), `category` (the StageCategory option value, custom values included), its table (`entity`), `nextStage` (`null` for the last stage) and `branches`: the conditions that lead out of the stage, each with its label and target (`nextStage` is then the stage when no condition applies). |
| classic workflow | `category` | `workflow`, `dialog`, `businessRule` or `action`. Only id, name, category, table and a business rule's scope are read. |
| business rule | `scope`, `forms` | Where it runs (`ProcessTriggerScope`): `entity` (the table: every form, and the server), `allForms`, or `form` with the form's id in `forms` (`ProcessTriggerFormId`). `null` and `[]` for other categories. |

Desktop flows and other process categories are not read.

### Pipelines

With a `plugins` folder (options file or `--plugins`), `components.json` also has `pipelines`:
what each entry plug-in of the DDSol plug-in architecture runs, read from its C# code. An entry
plug-in derives from `PipelinePluginBase`, names its table in `EntityLogicalName`, and declares
its components in `GetCreateSteps()`, `GetUpdateSteps()`, `GetDeleteSteps()` and
`GetSpecialSteps()` as `PipelineStepDescriptor { Type, ImplementationType, Order, Description }`.

```json
"pipelinesSource": "../../Plugins",
"pipelines": [
  { "pluginType": "Dvt.Plugins.EntityPluginRegistrations.Project.ProjectPreOperationPlugin", "registered": true,
    "entity": "dvt_project", "stage": 20, "stageName": "preOperation", "mode": "sync",
    "composition": "known", "reason": null,
    "messages": [
      { "message": "Update", "method": "GetUpdateSteps", "composition": "known", "reason": null,
        "components": [
          { "position": 1, "order": 10, "type": "Dvt.Plugins.Validators.Project.ProjectOwnerValidator", "kind": "validator",
            "declaredFilteringAttributes": ["ownerid"], "description": "Only the project lead may hand a project over; Update, …",
            "file": "Dvt.Plugins/Dvt.Plugins/Validators/Project/ProjectOwnerValidator.cs" } ] } ],
    "file": "Dvt.Plugins/Dvt.Plugins/EntityPluginRegistrations/Project/ProjectPreOperationPlugin.cs" },
  { "pluginType": "Dvt.Plugins.Project.ValidateBudget", "registered": true,
    "entity": null, "stage": null, "stageName": null, "mode": null,
    "composition": "unknown", "reason": "ValidateBudget derives from PluginBase, not PipelinePluginBase",
    "messages": [], "file": "Dvt.Plugins/Dvt.Plugins/Legacy/ValidateBudget.cs" }
]
```

- **`pipelinesSource`:** the Plugins folder, relative to the folder of `components.json`; `null`
  (and `pipelines: []`) without one. Every `file` in `pipelines` is relative to it. `bin/`,
  `obj/` and hidden folders are not read.
- **Which plug-ins:** every class that derives from `PipelinePluginBase`, every plug-in type the
  solution registers on a step, and every Custom API's implementing plug-in type. Sorted by
  `pluginType`. **`registered`** is `true` when a plug-in step of the solution runs it.
- **`entity`:** a string literal, or the `EntityLogicalName` constant of an early-bound class in
  the folder; otherwise `null`.
- **`stage`, `stageName`, `mode`:** from the entry plug-in's name:

  | Name ends with | `stage` | `mode` |
  |---|---|---|
  | `PreValidationPlugin` | 10 `preValidation` | `sync` (Pre-Validation is always synchronous) |
  | `PreOperationPlugin` | 20 `preOperation` | `sync` |
  | `PostOperationSyncPlugin` | 40 `postOperation` | `sync` |
  | `PostOperationAsyncPlugin` | 40 `postOperation` | `async` |
  | `PostOperationPlugin` | 40 `postOperation` | `null` |

  A declared `ExecutionMode` sets `mode`. `null` for other names. The solution's plug-in steps
  remain the authority for how a plug-in is registered.
- **`messages`:** one per step method that declares components, in the order Create, Update,
  Delete, then `GetSpecialSteps` (`message: null`: every other message the plug-in is
  registered on).
- **Run order:** by `Order`, then by full type name, as the pipeline engine (`PipelinePluginBase`)
  sorts them. `position` is the place in that order, from 1.
- **Components:**
  - `type` is the full type name, resolved from `typeof(…)` the way C# looks names up.
  - `kind` is the descriptor's `Type` (`validator`, `mutator`, `handler`), checked against the
    `IEntityValidator`/`IEntityMutator`/`IEntityHandler` the class implements. The folder is not
    used.
  - `declaredFilteringAttributes` comes from the description's `filtering attributes: a,b`
    (`[]` for `none`; `null` when it does not say).
- **`composition: "unknown"`:** dv-tools reads only code that follows the architecture and never
  guesses; `reason` says why.
  - **A whole plug-in** (no `messages`) when it is not an entry plug-in it can read: it does not
    derive from `PipelinePluginBase` (a registered plug-in outside the architecture, a Custom API
    implementation), derives from it through an intermediate base class, uses the legacy engine
    (`GetRegistration()`, or stage-specific step methods), is declared in several files, or is
    not in the folder.
  - **A message** (no `components`) when its step method or one of its components cannot be read:
    the method is not just `yield return new PipelineStepDescriptor { … }` statements (or one
    returned array or list), a property is not a literal (an `Order` from a constant), a
    component class cannot be found or two usings make it ambiguous, or a component declared as
    one kind implements another. The plug-in's other messages keep their components.

---

## What changed: `dv-convert diff`

Compares two `model.json` files, or one `model.json` at two git refs, and reports what changed
in the data model — for release notes or a review. Nothing is stored: the history is git's.

```bash
dv-convert diff old/model.json new/model.json
dv-convert diff --from dv-tools/v1.1.0                      # tag → working tree
dv-convert diff --from v2.3.0 --to v2.4.0 --format json     # two refs
```

```
Options:
  --from <ref>          Git ref of the older model (read with git show); a ref without the file counts as empty
  --to <ref>            Git ref of the newer model; default: the working tree
  --model <path>        model.json in the repository (default: <git root>/docs/datamodel/model.json)
  --format json|md      Output format (default: md)
  --output <file>       Write to a file instead of standard output
  --exit-code           Exit 1 when there are differences
```

**Exit codes:** `0` ok · `1` differences (with `--exit-code`) · `2` usage error · `3` input error
(unknown ref, missing or invalid file).

**Markdown** (`--format md`) is a release-note block: `### Data model changes (<from> → <to>)`,
a `**Solutions:**` line with each solution's version (`Core 1.0.0.3 → 1.0.0.4 · Sales 2.1`), and
tables for Tables, Columns, Choices and status reasons, Relationships and Keys.

**JSON** (`--format json`):

```json
{
  "diffSchema": 1,
  "from": { "ref": "v1.1.0", "modelSchema": 2, "solutions": [ { "order": 1, "name": "Core", "uniqueName": "DDSolCore", "version": "1.0.0.3" } ] },
  "to":   { "ref": "working tree", "modelSchema": 2, "solutions": [ ... ] },
  "summary": { "total": 3, "added": 2, "removed": 0, "modified": 1, "byKind": { "table": { "added": 1, "removed": 0, "modified": 0 }, ... } },
  "changes": [
    { "kind": "solution", "op": "modified", "solution": "DDSolCore", "label": "Core",
      "changes": { "version": { "from": "1.0.0.3", "to": "1.0.0.4" } } },
    { "kind": "table", "op": "added", "table": "ddsol_contract", "label": "Contract",
      "after": { ... }, "columns": [ { "name": "ddsol_contractid", "type": "primarykey", ... } ], "keys": [] },
    { "kind": "option", "op": "added", "optionSet": "task_statuscode", "value": 717170003, "label": "Waiting",
      "usedBy": ["Task.statuscode"], "after": { "label": "Waiting", "state": 0, "color": null, "isCustom": true } }
  ],
  "notes": []
}
```

- `kind` is one of `solution, table, column, optionSet, option, relationship, key` (changes come
  in this order); `op` is `added`, `removed` or `modified`. Added and removed items carry
  `after` / `before`, modified ones `changes` (`{ property: { from, to } }`).
- An added or removed table lists its `columns` and `keys` inside the record; an added or
  removed choice lists its `options`. `usedBy` names the columns that use a choice.
- `possibleRename` on an added table or column names a removed one with the same display name
  (and type). It is only a hint: Dataverse logical names cannot be renamed.
- Comparing a dv-tools 1.0.x model (schema 1) with a newer one reports only values both
  record, so the facts 1.1 added (lookup targets, status values, ...) do not show up as changes.

---

## Multi-solution / layered ALM

When your data model spans multiple Power Platform solutions (a base layer plus
domain-specific modules), pass all paths in dependency order — base first:

```bash
dv-convert ./Core ./Sales ./Service \
  --output ./datamodel \
  --solution-names Core,Sales,Service
```

Every table, column, relationship, and global option set will carry a `source_solution`
field showing which layer introduced it. If the same table appears in multiple layers,
columns are merged (first-wins by logical name) and the ownership/structural settings
are locked to the first layer that defines them.

A layer does not need tables: a solution with only plugins or flows is read from its
`Other/Solution.xml` and contributes to `components.json` and the provenance.

**Merge rules:**

| Element | Rule |
|---|---|
| Table `display_name`, `description` | Last-wins — later layers can refine labels |
| Table `ownership`, `is_activity` | First-wins — structural; taken from the first layer that defines them |
| `is_audit_enabled` | OR — any layer enabling it wins |
| Columns, relationships, global option sets | First-wins by logical name |
| Plugin steps, flows, processes (`components.json`) | First-wins by id (custom APIs by unique name) |

---

## Upgrading

```bash
npm install -g @powerbipro-eu/dv-tools@latest --registry=https://npm.pkg.github.com
dv-convert --version
```

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
