import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildOutputs } from '../src/converter.js';
import { VERSION } from '../src/version.js';
import { datamodel, filesOf, generatedFiles, layeredOptions, modelOf } from './helpers.js';

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('layered fixture: golden output', () => {
  it('matches the committed docs/datamodel byte for byte', () => {
    const produced = filesOf(buildOutputs(layeredOptions()));
    const golden = generatedFiles(datamodel);
    expect([...produced.keys()].sort()).toEqual([...golden.keys()]);
    for (const [name, content] of golden) expect(produced.get(name), name).toBe(content);
  });

  it('is byte-identical across runs', () => {
    expect(buildOutputs(layeredOptions()).files).toEqual(buildOutputs(layeredOptions()).files);
  });

  it('writes LF line endings and a trailing newline', () => {
    for (const { name, content } of buildOutputs(layeredOptions()).files) {
      expect(content.includes('\r'), name).toBe(false);
      expect(content.endsWith('\n') && !content.endsWith('\n\n'), name).toBe(true);
    }
  });
});

describe('model.json schema 2', () => {
  const model = modelOf(buildOutputs(layeredOptions()));
  const table = (name: string) => model.tables.find((t: any) => t.name === name);
  const field = (tableName: string, name: string) => table(tableName).fields.find((f: any) => f.name === name);
  const values = (collection: string, name: string) => model[collection].find((s: any) => s.name === name).values;

  it('starts with modelSchema and provenance, without parser positions', () => {
    expect(Object.keys(model).slice(0, 2)).toEqual(['modelSchema', 'provenance']);
    expect(model.modelSchema).toBe(2);
    expect(model.provenance).toEqual({
      generator: { name: '@powerbipro-eu/dv-tools', version: VERSION },
      config: 'dv-convert.json',
      layers: [
        {
          order: 1, name: 'Core', path: '../../solutions/Core', uniqueName: 'DvtCore', displayName: 'DVT Core', version: '1.0.0.3',
          publisher: { uniqueName: 'dvtools', customizationPrefix: 'dvt', optionValuePrefix: 12345 },
        },
        {
          order: 2, name: 'Sales', path: '../../solutions/Sales', uniqueName: 'DvtSales', displayName: 'DVT Sales', version: '2.1',
          publisher: { uniqueName: 'dvtools', customizationPrefix: 'dvt', optionValuePrefix: 12345 },
        },
      ],
    });
    expect(JSON.stringify(model)).not.toMatch(/"(token|filepath)"/);
  });

  it('sorts tables by logical name, refs and option sets by name', () => {
    expect(model.tables.map((t: any) => t.name)).toEqual(['Account', 'dvt_invoice', 'dvt_meeting', 'dvt_project', 'SystemUser', 'Task']);
    const names = (list: any[]) => list.map((x) => x.name);
    for (const list of [model.refs, model.optionSets, model.statusOptionSets, table('dvt_project').indexes]) {
      expect(names(list)).toEqual([...names(list)].sort());
    }
    // field order stays as in the source: base layer first, then the columns the second layer adds
    expect(table('dvt_project').fields.slice(-2).map((f: any) => f.name)).toEqual(['dvt_budget', 'dvt_invoicecount']);
  });

  it('marks our tables (publisher prefix) and our columns (IsCustomField)', () => {
    expect(table('dvt_project')).toMatchObject({ logicalName: 'dvt_project', isCustom: true });
    expect(table('Account')).toMatchObject({ logicalName: 'account', isCustom: false });
    expect(field('dvt_project', 'dvt_name').isCustom).toBe(true);
    expect(field('dvt_project', 'dvt_projectid').isCustom).toBe(false);   // the primary key of our table is platform-made
    expect(field('dvt_project', 'owningbusinessunit').isCustom).toBe(false);
  });

  it('names the computation of calculated, rollup and formula columns (sourceType)', () => {
    expect(field('dvt_project', 'dvt_daysopen').sourceType).toBe('calculated');   // SourceType 1
    expect(field('dvt_project', 'dvt_invoicecount').sourceType).toBe('rollup');   // 2, added by the second layer
    expect(field('dvt_project', 'dvt_label').sourceType).toBe('formula');         // 3
    expect(field('dvt_project', 'dvt_summary')).not.toHaveProperty('sourceType'); // 4, AI prompt column
    expect(field('dvt_project', 'dvt_name')).not.toHaveProperty('sourceType');    // 0
  });

  it('keeps platform tables that carry our columns as partial tables with a primary key', () => {
    expect(table('Task')).toMatchObject({ isCustom: false, isPartial: true, isActivity: true });
    expect(table('Task').fields[0]).toMatchObject({ name: 'activityid', pk: true, isCustom: false });
    expect(table('SystemUser')).toMatchObject({ isPartial: true });
    expect(table('SystemUser').fields[0]).toMatchObject({ name: 'systemuserid', pk: true });
    expect(table('Account').isPartial).toBeUndefined();   // fully defined platform table, kept as in 1.0.x
    expect(table('Contact')).toBeUndefined();            // partial, none of our columns
  });

  it('platformTables all / none', () => {
    const all = modelOf(buildOutputs(layeredOptions({ platformTables: 'all', writeDbml: false })));
    const contact = all.tables.find((t: any) => t.name === 'Contact');
    expect(contact).toMatchObject({ isPartial: true, isCustom: false });
    expect(contact.fields.map((f: any) => f.name)).toEqual(['contactid', 'jobtitle']);

    const none = modelOf(buildOutputs(layeredOptions({ platformTables: 'none', writeDbml: false })));
    expect(none.tables.map((t: any) => t.name)).toEqual(['dvt_invoice', 'dvt_meeting', 'dvt_project']);
  });

  it('fills lookup targets, including tables outside the model', () => {
    expect(field('dvt_project', 'dvt_accountid').targets).toBe('Account');
    expect(field('dvt_project', 'dvt_contactid').targets).toBe('Contact');
    expect(field('dvt_project', 'owningbusinessunit').targets).toBe('BusinessUnit');
    expect(field('Task', 'dvt_projectid').targets).toBe('dvt_project');
  });

  it('keeps every many-to-many relationship, whatever the casing in the XML', () => {
    const ref = (name: string) => model.refs.find((r: any) => r.name === name);
    const attendees = ref('dvt_project_meeting_attendees');
    const reviewers = ref('dvt_project_meeting_reviewers');   // same two tables: model.json only
    expect(reviewers).toEqual({ ...attendees, name: 'dvt_project_meeting_reviewers', intersectEntity: 'dvt_project_meeting_reviewers' });
    expect(ref('dvt_project_systemuser').endpoints.map((e: any) => e.tableName)).toEqual(['dvt_project', 'SystemUser']);
  });

  it('restores state values on status reasons and default status on states, including 0', () => {
    expect(values('stateOptionSets', 'dvt_project_statecode')).toEqual([
      { value: 0, label: 'Active', invariantName: 'Active', defaultStatus: 1 },
      { value: 1, label: 'Inactive', invariantName: 'Inactive', defaultStatus: 123450001 },
    ]);
    expect(values('statusOptionSets', 'dvt_invoice_statuscode').map((v: any) => [v.value, v.state])).toEqual([[1, 0], [2, 1]]);
  });

  it('marks status reasons we added and statuscode columns we modified', () => {
    const ours = (name: string) => values('statusOptionSets', name).filter((v: any) => v.isCustom).map((v: any) => v.value);
    // table we created, against the {1, 2} baseline: values added, 2 removed, default changed
    expect(ours('dvt_project_statuscode')).toEqual([123450000, 123450001]);
    expect(field('dvt_project', 'statuscode')).toMatchObject({ isModified: true, modifications: ['statusReasons'] });
    // activity we created, exactly the {1..4} baseline
    expect(ours('dvt_meeting_statuscode')).toEqual([]);
    expect(field('dvt_meeting', 'statuscode').isModified).toBeUndefined();
    // table we created, exactly the {1, 2} baseline
    expect(field('dvt_invoice', 'statuscode').isModified).toBeUndefined();
    // platform table: its own reasons (2-7) are not ours, the 9-digit one is
    expect(ours('task_statuscode')).toEqual([123450002]);
    expect(field('Task', 'statuscode')).toMatchObject({ isModified: true, modifications: ['statusReasons'] });
  });

  it('gives Yes/No option sets a values list next to the labels', () => {
    expect(model.bitOptionSets).toEqual([{
      name: 'dvt_project_dvt_isactive', schemaName: null, trueLabel: 'Running', falseLabel: 'Stopped',
      values: [{ value: 1, label: 'Running' }, { value: 0, label: 'Stopped' }],
    }]);
  });

  it('adds full descriptions and leaves the 1.0.x note as it was', () => {
    expect(field('dvt_project', 'dvt_description').description)
      .toBe('What the project delivers.\nShown on the project form; keep it short so that it fits the summary card (scope & goals).');
    expect(field('dvt_project', 'dvt_description').note).toBeUndefined();
    expect(field('dvt_project', 'dvt_isactive')).toMatchObject({
      note: { value: 'Running or stopped.&#xA;Set by the project owner.' },
      description: 'Running or stopped.\nSet by the project owner.',
    });
    // existing values are not rewritten: the table description stays as 1.0.x emitted it
    expect(table('dvt_project').description).toBe('A piece of work we deliver.&#xA;Owned by one business unit.');
  });

  it('matches colors case-insensitively', () => {
    expect(table('dvt_project').headerColor).toBe('#aa3366');   // colors.json key "DVT_Project"
    expect(table('Task').headerColor).toBe('#336699');          // colors.json key "task"
  });
});
