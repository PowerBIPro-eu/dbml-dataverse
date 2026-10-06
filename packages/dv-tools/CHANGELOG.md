# Changelog — @powerbipro-eu/dv-tools

Each release is tagged `dv-tools/v<version>` in this repository.

## 1.4.0

`model.json` and the `.dv.dbml` files are unchanged: for the same input they are byte-identical
to 1.3.0, apart from `provenance.generator.version`. `components.json` only gains content.

### Added
- `pipelines` and `pipelinesSource` in `components.json`: what each entry plug-in of the DDSol
  plug-in architecture runs, read from the C# code in a `Plugins/` folder named by the new
  options-file key `plugins` (relative to the file) or `--plugins`. For each entry plug-in:
  whether a solution step registers it, its table, stage and mode, and per message its
  validators, mutators and handlers in run order (by `Order`, then full type name, as
  `PipelinePluginBase` runs them), each with its full type name, kind, declared filtering
  attributes and file. Nothing is guessed: a plug-in it cannot read (outside the architecture,
  behind an intermediate base class, the legacy engine, a Custom API implementation, not in the
  folder) gets `composition: "unknown"` with the reason, and so does a single message whose step
  method or components it cannot read, while the other messages keep their components.
- Plug-in steps: `handlerKind` (`plugin`, `webhook` or `serviceEndpoint`) and `serviceEndpoint`
  (`{ id, name }`), from the step's handler type and the solution's
  `PluginAssemblies/ServiceEndpoints.xml`. A webhook or service endpoint step no longer has a
  plug-in type.
- Business rules (classic workflows of category `businessRule`): `scope` (`entity`, `allForms` or
  `form`) and `forms` (the form's id), from `ProcessTriggerScope` and `ProcessTriggerFormId`.
  Other classic workflows get `scope: null` and `forms: []`.

## 1.3.0

`model.json` and the `.dv.dbml` files are unchanged: for the same input they are byte-identical
to 1.2.0, apart from `provenance.generator.version`.

### Added
- `components.json` next to `model.json`: the solution's plugin assemblies, plugin types and steps,
  custom APIs (with their request parameters, response properties and implementing plug-in
  type), cloud flows (trigger, connection references, Dataverse actions), business process flows
  with their stages and branches, and classic workflows, read from every layer
  (`componentsSchema: 1`, the same `provenance` block as `model.json`). It is built in the same
  run, renamed into place before `model.json`, and compared by `--check`. `--no-components`
  skips it.
- A layer may be a solution without tables (only plugins, flows, …): an `Other/Solution.xml` is
  enough, an `Entities` folder is no longer required.

### Release process
- A manual run of the publish workflow must start from a `dv-tools/v<version>` tag, as the
  okf-tools workflow does; its version input must name the same version.

## 1.2.0

### Added
- `dv-convert diff`: what changed in the data model between two `model.json` files, or between
  git refs (`--from <ref> [--to <ref>]`, read with `git show`; the working tree by default).
  Markdown for release notes (`**Solutions:**` versions line; tables for tables, columns,
  choices and status reasons, relationships, keys) or JSON (`diffSchema: 1`). `--exit-code`
  exits 1 when something changed. `model.json` itself is unchanged.

## 1.1.0

`model.json` schema 2 only adds to schema 1: table, file and relationship names are unchanged.

### Added
- Options file `dv-convert.json` (`--config`, discovered in `./` or `<git root>/docs/datamodel/`,
  created with `--write-config`), with `--platform-tables` and `--check` (exit 1 when the output
  is stale). Exit codes: 0 ok, 1 stale, 2 usage or options-file error, 3 the model could not be built.
- `model.json` starts with `modelSchema: 2` and `provenance` (generator version; per layer: order,
  name, path, uniqueName, displayName, version, publisher prefixes from `Solution.xml`).
- Tables: `logicalName`, `isCustom`, `isPartial`. Columns: `isCustom` (`IsCustomField`), the full
  `description`, `isModified` + `modifications: ["statusReasons"]`. Status reasons we added:
  `isCustom`. Yes/No option sets: `values`.
- Platform tables that carry our columns (e.g. `Task`, `SystemUser`) are kept as partial tables
  with their primary key (`activityid` for activities, else `<logical name>id`).

### Fixed
- Output order no longer depends on the file system: Windows and Linux give identical files.
- Status reasons keep their `state` and states their `defaultStatus` (they were dropped, and 0 was lost).
- Columns a later layer adds to a table of an earlier layer are kept when that layer's XML holds
  only those columns.
- Lookup targets are filled for every relationship, also to tables outside the model.
- Every many-to-many relationship is kept (several between the same tables, platform tables named
  in lowercase); ones DBML cannot hold go to `model.json` only.
- `colors.json` keys are matched case-insensitively.
- A DBML error leaves the output folder untouched; it used to write the `.dv.dbml` files first.
- `.dv.dbml` files for tables that are no longer in the solution are removed.

### Changed
- `model.json` has no parser positions (`token`, `filepath`), uses LF line endings and ends with a newline.
- The package is 0.8 MB instead of 25.6 MB (only the DBML compiler is bundled) and runs about 4× faster.

## 1.0.4

### Fixed
- Custom Yes/No labels are kept on Node.js 22 and later. The label check compared two `Set`
  objects with `<=`, which is always true, so every Yes/No column was treated as having the
  default labels and its `BitOptionSet` was dropped. Node.js 20 was not affected.

### Added
- `dv-convert --version` prints the installed version.

### Release process
- The publish workflow runs the dv-tools tests and publishes only when the tag matches the
  version committed in `packages/dv-tools/package.json` (it no longer stamps the version from the tag).
- `yarn.lock` pins the build and XML-parser dependencies (vite 6.4.3, fast-xml-parser 5.9.3),
  the versions 1.0.1–1.0.3 were built with.

## 1.0.3
- Many-to-many relationships are emitted as valid DBML.

## 1.0.2
- `RequiredLevel` from the XML is normalized to a valid DBML token.

## 1.0.1
- Bundled dependencies moved to `devDependencies`; the package installs with no runtime dependencies.

## 1.0.0
- First release: multiple solution paths, merged in order, with `source_solution` metadata on every element.
