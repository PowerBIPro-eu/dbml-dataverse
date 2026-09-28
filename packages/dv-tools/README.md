# dv-tools — Dataverse → DBML Converter

Converts Power Platform / Dataverse solution XML into `.dv.dbml` and `model.json` files.
Supports layered ALM — pass multiple solution paths and every element gets stamped with
`source_solution` so you know which module introduced each table, column, or relationship.

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

- dv-convert owns only `*.dv.dbml` and `model.json`. It never touches `layout.json`,
  `dv-convert.json`, `colors.json` or any other file.
- Everything is built and validated in memory first. If the DBML does not compile, nothing
  is written and the folder stays as it was (exit code 3).
- Changed files are written to `<output>/.dv-convert.tmp/` and renamed into place,
  `model.json` last; unchanged files are left alone.
- `.dv.dbml` files that are no longer produced (a table removed from the solution) are
  deleted — except with `--no-dbml` and in single-entity mode.
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
  --no-dbml                    Skip .dv.dbml files, write only model.json
  --version                    Print the dv-tools version and exit
  --help, -h                   Show this help
```

**Exit codes:** `0` ok · `1` `--check` found stale output · `2` usage or options-file error
(unknown key, newer `configVersion`, invalid JSON, a solution folder that does not exist, a
`uniqueName` that does not match `Solution.xml`) · `3` the model could not be built (DBML error).

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
  "platformTables": "with-our-columns"
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

- Unknown keys are an error (exit code 2), so typos do not go unnoticed.
- Without solution paths or `--config`, dv-convert uses `./dv-convert.json`, otherwise
  `<git root>/docs/datamodel/dv-convert.json`.
- Command-line flags override the file's values (`--output`, `--colors`, `--no-dbml`,
  `--platform-tables`, `--solution-names`).
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

**Merge rules:**

| Element | Rule |
|---|---|
| Table `display_name`, `description` | Last-wins — later layers can refine labels |
| Table `ownership`, `is_activity` | First-wins — structural; taken from the first layer that defines them |
| `is_audit_enabled` | OR — any layer enabling it wins |
| Columns, relationships, global option sets | First-wins by logical name |

---

## Upgrading

```bash
npm install -g @powerbipro-eu/dv-tools@latest --registry=https://npm.pkg.github.com
dv-convert --version
```

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
