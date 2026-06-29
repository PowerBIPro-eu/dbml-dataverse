# dv-tools — Dataverse → DBML Converter

Converts Power Platform / Dataverse solution XML into `.dv.dbml` and `model.json` files.
Supports layered ALM — pass multiple solution paths and every element gets stamped with
`source_solution` so you know which module introduced each table, column, or relationship.

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

Verify it installed correctly:

```bash
dv-convert --help
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

# Custom diagram header colors per entity
dv-convert ./MySolution --output ./datamodel --colors colors.json
```

---

## What gets generated

Running against a solution writes one file per entity plus a global option sets file:

```
datamodel/
  global_option_sets.dv.dbml   ← shared picklists
  Account.dv.dbml
  Contact.dv.dbml
  Opportunity.dv.dbml
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

---

## Full CLI reference

```
dv-convert <solution-path> [solution-path ...] --output <dir> [options]
dv-convert <Entity.xml>    --output <dir>   (single entity, debug mode)

Options:
  --output, -o <dir>           Output directory (required)
  --colors <file>              JSON file mapping entity names to hex colors
  --solution-names <n1,n2,...> Override solution names (comma-separated, in order)
  --no-dbml                    Skip .dv.dbml files, write only model.json
  --help, -h                   Show this help
```

### colors.json format

```json
{
  "account":     "#1a73e8",
  "contact":     "#e53935",
  "opportunity": "#43a047"
}
```

Keys are the **logical entity names** (lowercase).

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
are locked to the base layer.

**Merge rules:**

| Element | Rule |
|---|---|
| Table `display_name`, `description` | Last-wins — later layers can refine labels |
| Table `ownership`, `is_activity` | First-wins — structural, locked to base layer |
| `is_audit_enabled` | OR — any layer enabling it wins |
| Columns, relationships, global option sets | First-wins by logical name |

---

## Upgrading

```bash
npm install -g @powerbipro-eu/dv-tools@latest --registry=https://npm.pkg.github.com
```

