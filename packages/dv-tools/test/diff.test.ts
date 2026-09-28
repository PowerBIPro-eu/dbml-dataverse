import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diffModels, type DiffChange } from '../src/diff/diff.js';
import { renderMarkdown } from '../src/diff/markdown.js';
import { run } from '../src/run.js';
import { datamodel, fixtures } from './helpers.js';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));
const model110 = () => read(join(datamodel, 'model.json'));
const model103 = () => read(join(fixtures, 'diff', 'model-1.0.3.json'));

/** kind/op/identity of each change, for compact expectations. */
const ids = (changes: DiffChange[]) => changes.map((c) =>
  [c.kind, c.op, c.solution ?? c.relationship ?? c.optionSet ?? c.table, c.column ?? c.key ?? c.value].filter((x) => x !== undefined).join(' '));

/** The layered golden model after a release with known edits. */
function nextRelease(): any {
  const m = model110();
  const table = (name: string) => m.tables.find((t: any) => t.name === name);
  const project = table('dvt_project');
  const field = (name: string) => project.fields.find((f: any) => f.name === name);

  m.provenance.layers[0].version = '1.0.0.4';
  // table removed, with its option sets and relationship
  m.tables = m.tables.filter((t: any) => t.name !== 'dvt_invoice');
  m.stateOptionSets = m.stateOptionSets.filter((s: any) => s.name !== 'dvt_invoice_statecode');
  m.statusOptionSets = m.statusOptionSets.filter((s: any) => s.name !== 'dvt_invoice_statuscode');
  m.refs = m.refs.filter((r: any) => r.name !== 'dvt_dvt_project_dvt_invoice' && r.name !== 'dvt_project_meeting_reviewers');
  // columns: added, modified, removed; a new lookup with the display name of a removed one
  field('dvt_name').displayName = 'Title';
  field('dvt_name').required = 'none';
  const reviewer = field('dvt_reviewerid');
  project.fields = project.fields.filter((f: any) => f.name !== 'dvt_reviewerid');
  project.fields.push({ ...reviewer, name: 'dvt_approverid' });
  project.fields.push({ ...field('dvt_name'), name: 'dvt_code', type: { schemaName: null, type_name: 'nvarchar(20)', args: '20' }, displayName: 'Code', required: 'none' });
  table('Task').fields = table('Task').fields.filter((f: any) => f.name !== 'dvt_effort');
  project.indexes.push({ columns: [{ value: 'dvt_code', type: 'column' }], unique: true, name: 'dvt_project_code_key' });
  // choices
  m.optionSets.find((s: any) => s.name === 'dvt_priority').displayName = 'Urgency';
  m.statusOptionSets.find((s: any) => s.name === 'dvt_project_statuscode').values.find((v: any) => v.value === 123450000).label = 'Paused';
  m.statusOptionSets.find((s: any) => s.name === 'task_statuscode').values.push({ value: 123450003, label: 'Waiting for parts', state: 0, isCustom: true });
  // relationship now uses the new lookup column
  m.refs.find((r: any) => r.name === 'dvt_systemuser_dvt_project_reviewerid').endpoints[1].fieldNames = ['dvt_approverid'];
  return m;
}

describe('diffModels', () => {
  it('1.0.3 → 1.1: additions only', () => {
    const result = diffModels(model103(), model110(), { from: 'v1.0.3', to: 'v1.1.0' });
    expect(result.summary).toMatchObject({ removed: 0, modified: 0 });
    expect(result.changes.every((c) => c.op === 'added')).toBe(true);
    expect(ids(result.changes)).toEqual([
      'solution added DvtCore',
      'solution added DvtSales',
      'table added SystemUser',
      'table added Task',
      'column added dvt_project dvt_budget',
      'optionSet added dvt_project_dvt_isactive',   // custom Yes/No labels, lost by 1.0.3 on Node 22+
      'optionSet added task_statuscode',
      'relationship added dvt_dvt_project_task',
      'relationship added dvt_project_meeting_attendees',   // 1.0.3 kept one N:N per pair of tables
      'relationship added dvt_project_systemuser',
      'relationship added dvt_systemuser_dvt_project_reviewerid',
    ]);
    expect(result.from).toEqual({ ref: 'v1.0.3', modelSchema: 1, solutions: [] });
    expect(result.notes).toHaveLength(2);   // schema 1 vs 2, no provenance
  });

  it('identical models: no changes', () => {
    const result = diffModels(model110(), model110(), { from: 'a', to: 'b' });
    expect(result.changes).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it('no model before: everything is added', () => {
    const result = diffModels(null, model110(), { from: 'v0', to: 'v1' });
    expect(result.summary).toMatchObject({ total: result.summary.added, removed: 0, modified: 0 });
    expect(result.from.modelSchema).toBeNull();
    expect(result.notes[0]).toBe('There is no model at v0; everything counts as added.');
  });

  describe('schema 2 → schema 2', () => {
    const result = diffModels(model110(), nextRelease(), { from: 'v1.1.0', to: 'v1.2.0' });
    const change = (kind: string, id: string) => result.changes.find((c) => ids([c])[0].startsWith(`${kind} `) && ids([c])[0].endsWith(` ${id}`));

    it('reports the expected records, kinds in order', () => {
      expect(ids(result.changes)).toEqual([
        'solution modified DvtCore',
        'table removed dvt_invoice',
        'column added dvt_project dvt_approverid',
        'column added dvt_project dvt_code',
        'column modified dvt_project dvt_name',
        'column removed dvt_project dvt_reviewerid',
        'column removed Task dvt_effort',
        'optionSet removed dvt_invoice_statecode',
        'optionSet removed dvt_invoice_statuscode',
        'optionSet modified dvt_priority',
        'option modified dvt_project_statuscode 123450000',
        'option added task_statuscode 123450003',
        'relationship removed dvt_dvt_project_dvt_invoice',
        'relationship removed dvt_project_meeting_reviewers',
        'relationship modified dvt_systemuser_dvt_project_reviewerid',
        'key added dvt_project dvt_project_code_key',
      ]);
      expect(result.summary).toMatchObject({ total: 16, added: 4, removed: 7, modified: 5 });
    });

    it('carries the property changes', () => {
      expect(change('solution', 'DvtCore')!.changes).toEqual({ version: { from: '1.0.0.3', to: '1.0.0.4' } });
      expect(change('column', 'dvt_name')!.changes).toEqual({
        displayName: { from: 'Name', to: 'Title' },
        required: { from: 'required', to: 'none' },
      });
      expect(change('option', '123450000')).toMatchObject({ label: 'Paused', usedBy: ['dvt_project.statuscode'], changes: { label: { from: 'On Hold', to: 'Paused' } } });
      expect(change('relationship', 'dvt_systemuser_dvt_project_reviewerid')!.changes).toEqual({
        endpoints: { from: 'SystemUser.systemuserid < dvt_project.dvt_reviewerid', to: 'SystemUser.systemuserid < dvt_project.dvt_approverid' },
      });
    });

    it('lists the columns of a removed table and hints at a possible rename', () => {
      const removed = change('table', 'dvt_invoice')!;
      expect(removed.columns!.map((c) => c.name)).toEqual(['dvt_amount', 'dvt_categorycode', 'dvt_invoiceid', 'dvt_projectid', 'statecode', 'statuscode']);
      expect(change('column', 'dvt_approverid')!.possibleRename).toBe('dvt_reviewerid');
      expect(change('column', 'dvt_code')!.possibleRename).toBeUndefined();
      expect(result.notes).toEqual(['Dataverse logical names cannot be renamed: possibleRename only means that a removed and an added item share a display name.']);
    });

    it('renders release-note Markdown', () => {
      expect(renderMarkdown(result)).toBe(readFileSync(join(fixtures, 'diff', 'v1.1.0-to-v1.2.0.md'), 'utf-8'));
    });
  });
});

describe('dv-convert diff', () => {
  let tmp: string;
  let stdout: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dv-convert-diff-'));
    stdout = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { stdout.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  const write = (name: string, model: unknown) => {
    const path = join(tmp, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(model, null, 2) + '\n');
    return path;
  };
  const json = () => JSON.parse(stdout.join('\n'));

  it('compares two files (Markdown by default, JSON on request)', async () => {
    const [a, b] = [write('a.json', model110()), write('b.json', nextRelease())];
    expect(await run(['diff', a, b])).toBe(0);
    expect(stdout.join('\n')).toMatch(/^### Data model changes \(/);

    stdout = [];
    expect(await run(['diff', a, b, '--format', 'json'])).toBe(0);
    expect(json()).toMatchObject({ diffSchema: 1, summary: { total: 16 } });
  });

  it('--exit-code: 1 with differences, 0 without', async () => {
    const [a, b] = [write('a.json', model110()), write('b.json', nextRelease())];
    expect(await run(['diff', a, b, '--exit-code'])).toBe(1);
    expect(await run(['diff', a, a, '--exit-code'])).toBe(0);
  });

  it('--output writes the result to a file', async () => {
    const [a, b] = [write('a.json', model110()), write('b.json', nextRelease())];
    expect(await run(['diff', a, b, '--output', join(tmp, 'changes.md')])).toBe(0);
    expect(readFileSync(join(tmp, 'changes.md'), 'utf-8')).toMatch(/^### Data model changes/);
    expect(stdout).toEqual([]);
  });

  it('reads git refs with git show; --to defaults to the working tree', async () => {
    const repo = join(tmp, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=dv-tools test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    write('repo/README.md', 'no model yet');
    git('add', '-A');
    git('commit', '-q', '-m', 'start');
    git('tag', 'v0');
    write('repo/docs/datamodel/model.json', model110());
    git('add', '-A');
    git('commit', '-q', '-m', '1.1');
    git('tag', 'v1');
    write('repo/docs/datamodel/model.json', nextRelease());   // working tree

    expect(await run(['diff', '--from', 'v1', '--format', 'json'], repo)).toBe(0);
    expect(json()).toMatchObject({ from: { ref: 'v1' }, to: { ref: 'working tree' }, summary: { total: 16 } });

    git('commit', '-q', '-am', '1.2');
    git('tag', 'v2');
    stdout = [];
    expect(await run(['diff', '--from', 'v1', '--to', 'v2', '--format', 'json'], repo)).toBe(0);
    expect(json().summary.total).toBe(16);

    // a ref without the model counts as empty
    stdout = [];
    expect(await run(['diff', '--from', 'v0', '--to', 'v1', '--format', 'json'], repo)).toBe(0);
    expect(json()).toMatchObject({ from: { modelSchema: null }, summary: { removed: 0, modified: 0 } });

    // --model, relative to the current folder
    stdout = [];
    expect(await run(['diff', '--from', 'v1', '--to', 'v2', '--model', 'datamodel/model.json', '--format', 'json'], join(repo, 'docs'))).toBe(0);
    expect(json().summary.total).toBe(16);

    expect(await run(['diff', '--from', 'no-such-tag'], repo)).toBe(3);
  });

  it.each([
    ['one file', ['diff', 'a.json']],
    ['files together with --from', ['diff', 'a.json', 'b.json', '--from', 'v1']],
    ['an unknown format', ['diff', 'a.json', 'b.json', '--format', 'xml']],
    ['neither files nor --from', ['diff']],
  ])('usage error (exit 2): %s', async (_label, args) => {
    write('a.json', model110());
    write('b.json', model110());
    expect(await run(args, tmp)).toBe(2);
  });

  it('input error (exit 3): missing file or invalid JSON', async () => {
    writeFileSync(join(tmp, 'broken.json'), '{ "tables": ');
    write('a.json', model110());
    expect(await run(['diff', 'a.json', 'missing.json'], tmp)).toBe(3);
    expect(await run(['diff', 'a.json', 'broken.json'], tmp)).toBe(3);
  });
});
