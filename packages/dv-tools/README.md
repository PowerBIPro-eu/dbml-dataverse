# dv-tools — Dataverse → DBML Converter

CLI tool that converts Dataverse solution XML into `.dv.dbml` files and `model.json`,
supporting the extended Dataverse DBML syntax used by this repo's fork of dbml-parse.

## Installation

### Option A — Node.js CLI (recommended for automated pipelines)

Requires **Node.js ≥ 18**.

**Step 1 — authenticate to GitHub Packages** (one time per machine):

Create a [GitHub Personal Access Token](https://github.com/settings/tokens) with the
`read:packages` scope, then add it to your user-level `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN_HERE
```

**Step 2 — install globally:**

```bash
npm install -g @powerbipro-eu/dv-tools --registry=https://npm.pkg.github.com
```

**Step 3 — run:**

```bash
# Single solution
dv-convert ./MySolution --output ./datamodel

# Multiple layered solutions (tables/columns from later layers are merged in)
dv-convert ./CoreSolution ./SalesModule ./ServiceModule --output ./datamodel

# Override solution display names (used in source_solution metadata)
dv-convert ./Core ./Sales --output ./out --solution-names Core,Sales

# With header colors
dv-convert ./MySolution --output ./datamodel --colors colors.json
```

---

### Option B — Python script (zero install, any machine with Python 3.10+)

No dependencies beyond the standard library.

```bash
# Download the script once
curl -O https://raw.githubusercontent.com/PowerBIPro-eu/dbml-dataverse/master/_samples/dv_converter.py

# Run it
python dv_converter.py ./MySolution --output ./datamodel
python dv_converter.py ./Core ./Sales ./Service --output ./datamodel
python dv_converter.py ./Core ./Sales --output ./out --solution-names Core,Sales
```

---

## CLI reference

```
dv-convert <solution-path> [solution-path ...] --output <dir> [options]
dv-convert <Entity.xml>    --output <dir>   # single entity debug mode

Options:
  --output, -o <dir>           Output directory (required)
  --colors <file>              JSON mapping entity names to hex header colors
  --solution-names <n1,n2,...> Override solution names (comma-separated)
  --no-dbml                    Skip .dv.dbml files, only write model.json
  --help, -h                   Show help
```

### colors.json format

```json
{
  "Account":     "#1a73e8",
  "Contact":     "#e53935",
  "Opportunity": "#43a047"
}
```

---

## Multi-solution / layered ALM

When your data model is split across multiple Power Platform solutions (e.g. a base
layer + domain modules), pass all solution paths in dependency order (base first):

```bash
dv-convert ./PowerBI_Core ./PowerBI_Sales ./PowerBI_Service \
  --output ./datamodel \
  --solution-names Core,Sales,Service
```

Every table, column, relationship, and global option set in the output will carry a
`source_solution` metadata field indicating which layer introduced it:

```dbml
Table account [display_name: 'Account', ownership: UserOwned, source_solution: 'Core'] {
  accountid uniqueidentifier [pk, required: systemrequired, source_solution: 'Core']
  dds_custom_field nvarchar(100) [required: none, source_solution: 'Sales']
  ...
}
```

**Merge rules:**

| Element | Rule |
|---|---|
| Table `display_name`, `description` | Last-wins (later layers can refine labels) |
| Table `ownership`, `is_activity` | First-wins (structural, cannot change) |
| Table `is_audit_enabled` | OR — any layer enabling it wins |
| Columns, relationships, global option sets | First-wins by logical name |

---

## Releasing a new version

Push a tag in the format `dv-tools/vX.Y.Z` to trigger the publish workflow:

```bash
git tag dv-tools/v1.1.0
git push origin dv-tools/v1.1.0
```

This builds and publishes `@powerbipro-eu/dv-tools@1.1.0` to GitHub Packages automatically.

You can also trigger it manually from the **Actions** tab → **Publish dv-tools** → **Run workflow**.
