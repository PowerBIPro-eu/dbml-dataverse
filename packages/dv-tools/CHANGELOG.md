# Changelog — @powerbipro-eu/dv-tools

Each release is tagged `dv-tools/v<version>` in this repository.

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
