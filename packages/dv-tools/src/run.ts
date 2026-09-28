import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildOutputs, buildSingleEntity } from './converter.js';
import { CONFIG_FILE, discoverConfig, makeConfig, readConfig, serializeConfig } from './config.js';
import { compareOutputs, writeOutputs } from './output.js';
import { DbmlCompileError } from './model/json.js';
import { UsageError } from './errors.js';
import { deriveSolutionName } from './merge.js';
import { PLATFORM_TABLES_VALUES, type ConvertOptions, type PlatformTables } from './types.js';
import { VERSION } from './version.js';

export const USAGE = `
dv-convert — Dataverse solution XML → .dv.dbml + model.json

Usage:
  dv-convert [options]                                  (uses dv-convert.json, see below)
  dv-convert --config <file> [options]
  dv-convert <solution-path> [solution-path ...] --output <dir> [options]
  dv-convert <Entity.xml>    --output <dir>             (single entity mode)

Options:
  --output, -o <dir>           Output directory (required with solution paths)
  --config <file>              Options file; cannot be combined with solution paths
  --write-config               Write <output>/dv-convert.json for these paths, then convert
  --check                      Compare with the output folder and write nothing (exit 1 if stale)
  --colors <file>              JSON file mapping table names to hex header colors
  --solution-names <n1,n2,...> Override solution names (comma-separated, matches order of paths)
  --platform-tables <mode>     with-our-columns (default), all or none
  --no-dbml                    Skip writing .dv.dbml files (only write model.json)
  --version                    Print the dv-tools version and exit
  --help, -h                   Show this help

Without solution paths or --config, dv-convert uses ./dv-convert.json, else
<git root>/docs/datamodel/dv-convert.json. Paths in that file are relative to it.
Flags override its values.

Exit codes: 0 ok, 1 --check found stale output, 2 usage or options-file error,
3 the model could not be built.

Examples:
  dv-convert ./MySolution --output ./datamodel
  dv-convert ./CoreSolution ./SalesModule ./ServiceModule --output ./datamodel
  dv-convert ./CoreSolution ./SalesModule --output ./out --solution-names Core,Sales
  dv-convert ./Core ./Sales --output ./docs/datamodel --solution-names Core,Sales --write-config
  dv-convert --check
  dv-convert ./src/Entities/ddsol_svc_ticket/Entity.xml --output ./out
`.trim();

export const EXIT = { ok: 0, stale: 1, usage: 2, input: 3 } as const;

function parseCli(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output:            { type: 'string', short: 'o' },
        config:            { type: 'string' },
        'write-config':    { type: 'boolean', default: false },
        check:             { type: 'boolean', default: false },
        colors:            { type: 'string' },
        'solution-names':  { type: 'string' },
        'platform-tables': { type: 'string' },
        'no-dbml':         { type: 'boolean', default: false },
        version:           { type: 'boolean', default: false },
        help:              { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err: any) {
    throw new UsageError(err.message);
  }
}

type CliArgs = ReturnType<typeof parseCli>;

type Invocation =
  | { kind: 'single'; entityXml: string; outputDir: string }
  | { kind: 'solutions'; options: ConvertOptions; writeConfig: boolean; colorsPath: string | null };

function loadColors(path: string | null): Record<string, string> {
  if (!path) return {};
  if (!existsSync(path)) {
    console.error(`Warning: colors file not found: ${path}`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
  } catch (e: any) {
    console.error(`Warning: could not load colors file: ${e.message}`);
    return {};
  }
}

function splitNames(arg: string | undefined, count: number): string[] | undefined {
  if (!arg) return undefined;
  const names = arg.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length !== count) {
    throw new UsageError(`--solution-names has ${names.length} entries but ${count} solutions were given.`);
  }
  return names;
}

function platformTablesFlag(value: string | undefined): PlatformTables | undefined {
  if (value === undefined) return undefined;
  if (!PLATFORM_TABLES_VALUES.includes(value as PlatformTables)) {
    throw new UsageError(`--platform-tables must be one of: ${PLATFORM_TABLES_VALUES.join(', ')}`);
  }
  return value as PlatformTables;
}

/** Work out what to convert: options file (explicit or discovered) or paths on the command line. */
function resolveInvocation(args: CliArgs, argv: string[], cwd: string): Invocation | null {
  const { values, positionals } = args;
  const hasPaths = positionals.length > 0;
  if (values.config && hasPaths) throw new UsageError('--config cannot be combined with solution paths');
  if (values['write-config'] && values.config) throw new UsageError('--write-config cannot be combined with --config');
  if (values['write-config'] && values.check) throw new UsageError('--write-config cannot be combined with --check');
  if (values['write-config'] && !hasPaths) throw new UsageError('--write-config needs the solution paths and --output');
  const platformTables = platformTablesFlag(values['platform-tables']);

  let configFile = values.config ? resolve(cwd, values.config) : null;
  if (!configFile && !hasPaths) {
    configFile = discoverConfig(cwd);
    if (!configFile) {
      if (argv.length === 0) return null;   // bare `dv-convert` without an options file: show usage
      throw new UsageError(`no solution paths given and no ${CONFIG_FILE} found (looked in the current folder and in <git root>/docs/datamodel)`);
    }
    console.error(`Using ${configFile}`);
  }

  if (configFile) {
    const config = readConfig(configFile);
    const dir = dirname(configFile);
    const names = splitNames(values['solution-names'], config.solutions.length);
    const colorsPath = values.colors ? resolve(cwd, values.colors) : config.colors ? resolve(dir, config.colors) : null;
    return {
      kind: 'solutions',
      options: {
        solutions: config.solutions.map((s, i) => ({
          path: resolve(dir, s.path),
          name: names?.[i] ?? s.name ?? deriveSolutionName(s.path),
          uniqueName: s.uniqueName,
        })),
        outputDir: values.output ? resolve(cwd, values.output) : resolve(dir, config.output ?? '.'),
        writeDbml: values['no-dbml'] ? false : config.dbml ?? true,
        colors: loadColors(colorsPath),
        platformTables: platformTables ?? config.platformTables ?? 'with-our-columns',
        configPath: configFile,
      },
      writeConfig: false,
      colorsPath,
    };
  }

  // Solution paths on the command line
  if (!values.output) throw new UsageError('--output is required');
  const outputDir = resolve(cwd, values.output);
  const paths = positionals.map((p) => resolve(cwd, p));
  for (const p of paths) {
    if (!existsSync(p)) throw new UsageError(`path not found: ${p}`);
  }

  // Single entity XML (only valid for a single path)
  if (paths.length === 1 && paths[0].endsWith('.xml') && paths[0].toLowerCase().includes('entity')) {
    if (values['write-config']) throw new UsageError('--write-config needs solution folders, not an Entity.xml');
    return { kind: 'single', entityXml: paths[0], outputDir };
  }

  const names = splitNames(values['solution-names'], paths.length);
  const colorsPath = values.colors ? resolve(cwd, values.colors) : null;
  return {
    kind: 'solutions',
    options: {
      solutions: paths.map((p, i) => ({ path: p, name: names?.[i] ?? deriveSolutionName(p) })),
      outputDir,
      writeDbml: !values['no-dbml'],
      colors: loadColors(colorsPath),
      platformTables: platformTables ?? 'with-our-columns',
      configPath: values['write-config'] ? join(outputDir, CONFIG_FILE) : null,
    },
    writeConfig: !!values['write-config'],
    colorsPath,
  };
}

/** Run dv-convert; returns the exit code (0 ok, 1 stale with --check, 2 usage, 3 input). */
export async function run(argv: string[], cwd: string = process.cwd()): Promise<number> {
  if (argv.includes('--version')) {
    console.log(VERSION);
    return EXIT.ok;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT.ok;
  }

  try {
    const args = parseCli(argv);
    const invocation = resolveInvocation(args, argv, cwd);
    if (!invocation) {
      console.log(USAGE);
      return EXIT.ok;
    }

    const outputDir = invocation.kind === 'single' ? invocation.outputDir : invocation.options.outputDir;
    const result = invocation.kind === 'single'
      ? buildSingleEntity(invocation.entityXml)
      : buildOutputs(invocation.options);
    const outputSet = { files: result.files, pruneDbml: invocation.kind === 'solutions' && invocation.options.writeDbml };

    if (args.values.check) {
      const delta = compareOutputs(outputDir, outputSet);
      for (const name of delta.changed) console.log(`Stale: ${name}`);
      for (const name of delta.stale) console.log(`Stale: ${name} (no longer generated)`);
      const count = delta.changed.length + delta.stale.length;
      console.log(count
        ? `dv-convert --check: ${count} file(s) out of date in ${outputDir}; run dv-convert to update.`
        : `dv-convert --check: ${outputDir} is up to date.`);
      return count ? EXIT.stale : EXIT.ok;
    }

    const delta = writeOutputs(outputDir, outputSet);
    for (const name of delta.changed) console.error(`Written: ${name}`);
    for (const name of delta.stale) console.error(`Removed: ${name}`);
    if (delta.unchanged.length) console.error(`Unchanged: ${delta.unchanged.length} file(s)`);

    if (invocation.kind === 'solutions' && invocation.writeConfig) {
      const config = makeConfig({
        outputDir,
        solutions: result.layers.map(({ input, info }) => ({ path: input.path, name: input.name, uniqueName: info.uniqueName })),
        colorsPath: invocation.colorsPath,
        dbml: invocation.options.writeDbml,
        platformTables: invocation.options.platformTables,
      });
      writeFileSync(join(outputDir, CONFIG_FILE), serializeConfig(config), 'utf-8');
      console.error(`Written: ${CONFIG_FILE}`);
    }

    console.error('\nDone.');
    return EXIT.ok;
  } catch (err: any) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}`);
      console.error('Run with --help for usage information.');
      return EXIT.usage;
    }
    if (err instanceof DbmlCompileError) {
      console.error('\nDBML validation errors (nothing was written):');
      for (const d of err.diags) {
        console.error(`  • ${d.file ? `${d.file}:${d.location.start.line}: ` : ''}${d.message}`);
      }
      return EXIT.input;
    }
    console.error(`Error: ${err?.message ?? err}`);
    return EXIT.input;
  }
}
