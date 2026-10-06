# dv-tools test fixtures

All fixtures are synthetic: fictional tables with the publisher prefix `dvt` (option-value
prefix 12345), modelled on the layout of unpacked Dataverse solutions. This repository is
public, so no solution XML from real projects is committed here.

| Fixture | What it covers |
|---|---|
| `layered/` | A solution repository with two layers (`solutions/Core` with a `src/` folder, `solutions/Sales` without) and its generated ERD in `docs/datamodel/` |
| `bit-labels/` | Yes/No columns with custom and default labels |
| `invalid-dbml/` | A column name that breaks the DBML compiler |
| `diff/model-1.0.3.json` | What dv-tools 1.0.3 generated from `layered/solutions` (without the `dvt_project_systemuser` relationship, which 1.0.3 cannot convert, and before the computed columns were added): the schema-1 side of the 1.0.3 → 1.1 diff |
| `diff/v1.1.0-to-v1.2.0.md` | Expected `dv-convert diff` Markdown for the edits `test/diff.test.ts` applies to the layered model |

`layered/` exercises partial platform tables (`Task`, an activity without `<IsActivity>`;
`SystemUser`, an excluded system table), a platform table without our columns (`Contact`,
left out by default), a fully defined platform table (`Account`), lookup targets outside the
model, status reasons against both baselines (`dvt_project` modified, `dvt_meeting` activity
and `dvt_invoice` table unmodified, our 9-digit value on `Task`), two N:N between the same
tables, case-insensitive colours, a second layer that extends a base-layer table, and computed
columns of every `SourceType` on `dvt_project`: calculated, formula (Power Fx) and AI prompt in
the base layer, a rollup over the invoices in the second layer. Like exported solutions, they
name their definition files (`FormulaDefinitionFileName`); the fixture leaves those files out,
dv-tools does not read them.

Its components (`components.json`) are just as fictional: a plugin assembly `Dvt.Plugins` with
plugin types and a custom workflow activity (`PluginAssemblies/`, without the `.dll`), a webhook
and a Service Bus queue (`PluginAssemblies/ServiceEndpoints.xml`, placeholder addresses); plugin
steps on platform messages, on a custom action without a table, of a plugin package, on the
webhook, the queue and an endpoint outside the solution, with
images and filtering attributes, with and without names in the Plugin Registration Tool
convention, and one step that both layers contain (`SdkMessageProcessingSteps/`); custom APIs
that are global, bound to a table and bound to a table collection, naming their plug-in type by
export key, by an id outside the solution or not at all, with request parameters and response
properties, and one that both layers contain (`customapis/`, in the layout of Microsoft's "Create
a custom API with solution files"); cloud flows
with a Dataverse row trigger, a recurrence and a Power Apps trigger, nested Dataverse actions
and connection references; a business process flow over two tables with a branch; classic
workflows (a background workflow, business rules on the table, on all forms and on one form, an
action) and a desktop flow, which is not read (`Workflows/`). The classic workflows have only their `.data.xml`, the one file dv-tools
reads. Their formats follow public unpacked solutions (Microsoft samples on GitHub).

`layered/Plugins/` is the plug-in C# code that `dv-convert.json` names (`plugins`), laid out like
the DDSol plug-in architecture, with the bodies left out and a README in every folder:
- entry plug-ins for `dvt_project`, `dvt_invoice` and `dvt_meeting` with validators, mutators and
  handlers, at Pre-Validation, Pre-Operation and Post-Operation (one without sync or async in its
  name); one of them registered by a step of the solution;
- Update steps declared out of order and two handlers with the same `Order`;
- a handler that entry plug-ins of all three tables run;
- both declaration forms (`yield return`, a returned array), a file-scoped namespace, and the
  table as an early-bound constant or a string literal;
- deliberate deviations, each reported as unknown:
  - steps that depend on a condition (one message unknown, the other readable);
  - the legacy engine's `GetRegistration()`;
  - an entry plug-in behind an intermediate base class;
  - a registered plug-in from before the architecture (`Legacy/`);
  - a Custom API implementation (`Api/`);
- build output in `obj/`, which is not read.

## Golden files

`layered/docs/datamodel/*.dv.dbml`, `model.json` and `components.json` are the expected
output. The tests compare them byte for byte (LF, see `.gitattributes`); after an intended
change, regenerate them from the repository root:

```bash
cd packages/dbml-parse && npx vite build && cd ../dv-tools && npx vite build && cd ../..
node packages/dv-tools/dist/cli.mjs --config packages/dv-tools/test/fixtures/layered/docs/datamodel/dv-convert.json
```

`provenance.generator.version` in `model.json` and `components.json` follows
`packages/dv-tools/package.json`, so a version bump needs a regeneration too.
