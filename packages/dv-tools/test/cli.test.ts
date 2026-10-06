import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/run.js';
import { VERSION } from '../src/version.js';
import { configFile, coreSolution, fixtures, pluginsFolder, salesSolution } from './helpers.js';

let tmp: string;
let stdout: string[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dv-convert-test-'));
  stdout = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { stdout.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

const portable = (from: string, to: string) => relative(from, to).split('\\').join('/');

/** name → content of every file in a folder (recursively, for "left untouched" checks). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      out[portable(dir, path)] = readFileSync(path, 'utf-8');
    }
  }
  return out;
}

function writeConfig(dir: string, config: unknown): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'dv-convert.json');
  writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config));
  return file;
}

describe('dv-convert CLI', () => {
  it('--version prints the version', async () => {
    expect(await run(['--version'])).toBe(0);
    expect(stdout).toEqual([VERSION]);
  });

  it('--check: 0 when the fixture output is current', async () => {
    expect(await run(['--config', configFile, '--check'])).toBe(0);
  });

  it('writes atomically, prunes stale .dv.dbml and never touches files it does not own', async () => {
    writeFileSync(join(tmp, 'layout.json'), '{"positions":{}}');
    writeFileSync(join(tmp, 'notes.md'), 'keep me');
    writeFileSync(join(tmp, 'Retired.dv.dbml'), '// table removed from the solution');

    expect(await run(['--config', configFile, '--output', tmp])).toBe(0);
    const files = readdirSync(tmp).sort();
    expect(files).toContain('model.json');
    expect(files).toContain('Task.dv.dbml');
    expect(files).not.toContain('Retired.dv.dbml');
    expect(files).not.toContain('.dv-convert.tmp');
    expect(readFileSync(join(tmp, 'layout.json'), 'utf-8')).toBe('{"positions":{}}');
    expect(readFileSync(join(tmp, 'notes.md'), 'utf-8')).toBe('keep me');

    // up to date → 0; any difference → 1
    expect(await run(['--config', configFile, '--output', tmp, '--check'])).toBe(0);
    writeFileSync(join(tmp, 'model.json'), '{}\n');
    expect(await run(['--config', configFile, '--output', tmp, '--check'])).toBe(1);
    expect(stdout.some((line) => line === 'Stale: model.json')).toBe(true);
  });

  it('--check reports a .dv.dbml that would be removed', async () => {
    expect(await run(['--config', configFile, '--output', tmp])).toBe(0);
    writeFileSync(join(tmp, 'Retired.dv.dbml'), '');
    expect(await run(['--config', configFile, '--output', tmp, '--check'])).toBe(1);
    expect(existsSync(join(tmp, 'Retired.dv.dbml'))).toBe(true);   // --check writes nothing
  });

  it('--no-dbml leaves existing .dv.dbml files alone', async () => {
    writeFileSync(join(tmp, 'Handmade.dv.dbml'), '// not ours to delete');
    expect(await run(['--config', configFile, '--output', tmp, '--no-dbml'])).toBe(0);
    expect(readdirSync(tmp).sort()).toEqual(['Handmade.dv.dbml', 'components.json', 'model.json']);
  });

  it('--check compares components.json; --no-components skips it and leaves it alone', async () => {
    expect(await run(['--config', configFile, '--output', tmp])).toBe(0);
    writeFileSync(join(tmp, 'components.json'), '{}\n');
    expect(await run(['--config', configFile, '--output', tmp, '--check'])).toBe(1);
    expect(stdout).toContain('Stale: components.json');

    expect(await run(['--config', configFile, '--output', tmp, '--check', '--no-components'])).toBe(0);
    expect(await run(['--config', configFile, '--output', tmp, '--no-components'])).toBe(0);
    expect(readFileSync(join(tmp, 'components.json'), 'utf-8')).toBe('{}\n');
  });

  it('accepts a layer without tables (only Other/Solution.xml and components)', async () => {
    const plugins = join(tmp, 'Plugins');
    mkdirSync(join(plugins, 'Other'), { recursive: true });
    mkdirSync(join(plugins, 'SdkMessageProcessingSteps'));
    writeFileSync(join(plugins, 'Other', 'Solution.xml'), readFileSync(join(salesSolution, 'Other', 'Solution.xml'), 'utf-8')
      .replace('<UniqueName>DvtSales</UniqueName>', '<UniqueName>DvtPlugins</UniqueName>'));
    const step = '{d7a5e000-0000-4000-8000-000000000206}.xml';
    writeFileSync(join(plugins, 'SdkMessageProcessingSteps', step), readFileSync(join(salesSolution, 'SdkMessageProcessingSteps', step), 'utf-8'));

    const out = join(tmp, 'out');
    expect(await run([coreSolution, plugins, '--output', out, '--solution-names', 'Core,Plugins'])).toBe(0);
    const components = JSON.parse(readFileSync(join(out, 'components.json'), 'utf-8'));
    expect(components.provenance.layers.map((l: any) => l.uniqueName)).toEqual(['DvtCore', 'DvtPlugins']);
    expect(components.pluginSteps.find((s: any) => s.primaryEntity === 'dvt_invoice').sourceSolution).toBe('Plugins');
  });

  it('a DBML error exits 3 and leaves the output folder untouched', async () => {
    expect(await run(['--config', configFile, '--output', tmp])).toBe(0);
    writeFileSync(join(tmp, 'layout.json'), '{}');
    const before = snapshot(tmp);
    expect(await run([join(fixtures, 'invalid-dbml'), '--output', tmp])).toBe(3);
    expect(snapshot(tmp)).toEqual(before);
  });

  it('--write-config writes dv-convert.json into the output folder, paths relative to it', async () => {
    const out = join(tmp, 'docs', 'datamodel');
    expect(await run([coreSolution, salesSolution, '--output', out, '--solution-names', 'Core,Sales', '--write-config'])).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'dv-convert.json'), 'utf-8'))).toEqual({
      configVersion: 1,
      solutions: [
        { path: portable(out, coreSolution), name: 'Core', uniqueName: 'DvtCore' },
        { path: portable(out, salesSolution), name: 'Sales', uniqueName: 'DvtSales' },
      ],
      output: '.',
      dbml: true,
      platformTables: 'with-our-columns',
    });
    expect(JSON.parse(readFileSync(join(out, 'model.json'), 'utf-8')).provenance.config).toBe('dv-convert.json');
    expect(await run(['--config', join(out, 'dv-convert.json'), '--check'])).toBe(0);
  });

  it('--plugins reads the pipelines; --write-config records the folder relative to the output', async () => {
    const out = join(tmp, 'docs', 'datamodel');
    expect(await run([coreSolution, salesSolution, '--output', out, '--plugins', pluginsFolder, '--write-config'])).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'dv-convert.json'), 'utf-8')).plugins).toBe(portable(out, pluginsFolder));
    expect(JSON.parse(readFileSync(join(out, 'components.json'), 'utf-8')).pipelines.length).toBeGreaterThan(0);
    expect(await run(['--config', join(out, 'dv-convert.json'), '--check'])).toBe(0);
  });

  it('discovers <git root>/docs/datamodel/dv-convert.json when no paths are given', async () => {
    const repo = join(tmp, 'repo');
    const out = join(repo, 'docs', 'datamodel');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    writeConfig(out, {
      configVersion: 1,
      solutions: [{ path: portable(out, coreSolution), name: 'Core' }, { path: portable(out, salesSolution), name: 'Sales' }],
    });

    const cwd = join(repo, 'src', 'deep');
    expect(await run(['--check'], cwd)).toBe(1);   // nothing generated yet
    expect(await run([], cwd)).toBe(0);            // bare dv-convert uses the discovered file
    expect(existsSync(join(out, 'model.json'))).toBe(true);
    expect(await run(['--check'], cwd)).toBe(0);
    expect(await run(['--check'], out)).toBe(0);   // ./dv-convert.json
  });

  it('solution paths on the command line work as in 1.0.x (no options file)', async () => {
    expect(await run([coreSolution, salesSolution, '--output', tmp, '--solution-names', 'Core,Sales'])).toBe(0);
    const model = JSON.parse(readFileSync(join(tmp, 'model.json'), 'utf-8'));
    expect(model.provenance.config).toBeNull();
    expect(model.provenance.layers.map((l: any) => l.path)).toEqual([portable(tmp, coreSolution), portable(tmp, salesSolution)]);
    expect(existsSync(join(tmp, 'dv-convert.json'))).toBe(false);
  });

  it('single-entity mode writes that entity and prunes nothing', async () => {
    writeFileSync(join(tmp, 'Other.dv.dbml'), '// from a full run');
    const entityXml = join(fixtures, 'bit-labels', 'Entities', 'ddsol_widget', 'Entity.xml');
    expect(await run([entityXml, '--output', tmp])).toBe(0);
    expect(readdirSync(tmp).sort()).toEqual(['Other.dv.dbml', 'ddsol_widget.dv.dbml', 'model.json']);
  });

  describe('usage and options-file errors exit 2', () => {
    // built inside the test: tmp only exists then
    const core = () => portable(tmp, coreSolution);

    it.each([
      ['an unknown key', () => ({ configVersion: 1, solutions: [{ path: core() }], colours: 'colors.json' })],
      ['an unknown key in a solution', () => ({ configVersion: 1, solutions: [{ path: core(), version: '1.0' }] })],
      ['a newer configVersion', () => ({ configVersion: 2, solutions: [{ path: core() }] })],
      ['a uniqueName that does not match Solution.xml', () => ({ configVersion: 1, solutions: [{ path: core(), uniqueName: 'SomethingElse' }] })],
      ['a solution folder that does not exist', () => ({ configVersion: 1, solutions: [{ path: 'missing' }] })],
      ['an unknown platformTables value', () => ({ configVersion: 1, solutions: [{ path: core() }], platformTables: 'some' })],
      ['a Plugins folder that does not exist', () => ({ configVersion: 1, solutions: [{ path: core() }], plugins: 'NoSuchFolder' })],
      ['plugins that is not a path', () => ({ configVersion: 1, solutions: [{ path: core() }], plugins: true })],
      ['invalid JSON', () => '{ "configVersion": 1, '],
    ])('%s', async (_label, config) => {
      expect(await run(['--config', writeConfig(tmp, config()), '--check'])).toBe(2);
    });

    it.each([
      ['--config together with paths', () => ['--config', configFile, coreSolution]],
      ['an unknown flag', () => [coreSolution, '--output', tmp, '--colours', 'x.json']],
      ['paths without --output', () => [coreSolution]],
      ['a bad --platform-tables value', () => [coreSolution, '--output', tmp, '--platform-tables', 'some']],
      ['a --plugins folder that does not exist', () => [coreSolution, '--output', tmp, '--plugins', join(tmp, 'missing')]],
      ['--write-config without paths', () => ['--write-config']],
      ['--check without paths or options file', () => ['--check']],
    ])('%s', async (_label, args) => {
      expect(await run(args(), tmp)).toBe(2);
    });
  });
});
