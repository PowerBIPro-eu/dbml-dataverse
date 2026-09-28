# dv-tools test fixtures

All fixtures are synthetic: fictional tables with the publisher prefix `dvt` (option-value
prefix 12345), modelled on the layout of unpacked Dataverse solutions. This repository is
public, so no solution XML from real projects is committed here.

| Fixture | What it covers |
|---|---|
| `layered/` | A solution repository with two layers (`solutions/Core` with a `src/` folder, `solutions/Sales` without) and its generated ERD in `docs/datamodel/` |
| `bit-labels/` | Yes/No columns with custom and default labels |
| `invalid-dbml/` | A column name that breaks the DBML compiler |

`layered/` exercises partial platform tables (`Task`, an activity without `<IsActivity>`;
`SystemUser`, an excluded system table), a platform table without our columns (`Contact`,
left out by default), a fully defined platform table (`Account`), lookup targets outside the
model, status reasons against both baselines (`dvt_project` modified, `dvt_meeting` activity
and `dvt_invoice` table unmodified, our 9-digit value on `Task`), two N:N between the same
tables, case-insensitive colours and a second layer that extends a base-layer table.

## Golden files

`layered/docs/datamodel/*.dv.dbml` and `model.json` are the expected output. The tests
compare them byte for byte (LF, see `.gitattributes`); after an intended change, regenerate
them from the repository root:

```bash
cd packages/dbml-parse && npx vite build && cd ../dv-tools && npx vite build && cd ../..
node packages/dv-tools/dist/cli.mjs --config packages/dv-tools/test/fixtures/layered/docs/datamodel/dv-convert.json
```

`provenance.generator.version` in `model.json` follows `packages/dv-tools/package.json`, so a
version bump needs a regeneration too.
