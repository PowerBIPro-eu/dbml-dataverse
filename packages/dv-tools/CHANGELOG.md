# Changelog — @powerbipro-eu/dv-tools

Each release is tagged `dv-tools/v<version>` in this repository.

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
