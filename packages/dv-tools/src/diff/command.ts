import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { diffModels } from './diff.js';
import { renderMarkdown } from './markdown.js';
import { InputError, UsageError } from '../errors.js';

export const DIFF_USAGE = `
dv-convert diff — what changed in the data model between two model.json files

Usage:
  dv-convert diff <from.json> <to.json> [options]
  dv-convert diff --from <ref> [--to <ref>] [--model <path>] [options]

Options:
  --from <ref>          Git ref of the older model (read with git show); a ref without the file counts as empty
  --to <ref>            Git ref of the newer model; default: the working tree
  --model <path>        model.json in the repository (default: <git root>/docs/datamodel/model.json)
  --format json|md      Output format (default: md)
  --output <file>       Write to a file instead of standard output
  --exit-code           Exit 1 when there are differences
  --help, -h            Show this help

Exit codes: 0 ok, 1 differences (with --exit-code), 2 usage error, 3 input error.
`.trim();

function parseDiffArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        from:        { type: 'string' },
        to:          { type: 'string' },
        model:       { type: 'string' },
        format:      { type: 'string', default: 'md' },
        output:      { type: 'string' },
        'exit-code': { type: 'boolean', default: false },
        help:        { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err: any) {
    throw new UsageError(err.message);
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
}

function parseModel(json: string, source: string): Record<string, any> {
  try {
    return JSON.parse(json.replace(/^﻿/, ''));
  } catch (err: any) {
    throw new InputError(`${source} is not valid JSON (${err.message})`);
  }
}

function readModelFile(path: string, label: string): Record<string, any> {
  let json: string;
  try { json = readFileSync(path, 'utf-8'); } catch { throw new InputError(`${label}: file not found (${path})`); }
  return parseModel(json, label);
}

interface Inputs {
  from: Record<string, any> | null;
  to: Record<string, any>;
  refs: { from: string; to: string };
}

function readInputs(values: ReturnType<typeof parseDiffArgs>['values'], positionals: string[], cwd: string): Inputs {
  if (positionals.length) {
    if (positionals.length !== 2) throw new UsageError('give two model.json files, or --from <ref>');
    if (values.from || values.to || values.model) throw new UsageError('model.json files cannot be combined with --from, --to or --model');
    const [a, b] = positionals;
    return { from: readModelFile(resolve(cwd, a), a), to: readModelFile(resolve(cwd, b), b), refs: { from: a, to: b } };
  }
  if (!values.from) throw new UsageError('give two model.json files, or --from <ref>');

  let root: string;
  try { root = git(['rev-parse', '--show-toplevel'], cwd).trim(); } catch { throw new InputError('--from needs a git repository (git rev-parse failed)'); }
  // `<ref>:./path` is relative to cwd, so no comparison with git's (long-form) root path is needed
  const model = values.model
    ? { spec: `./${relative(cwd, resolve(cwd, values.model)).split(sep).join('/')}`, file: resolve(cwd, values.model), label: values.model }
    : { spec: 'docs/datamodel/model.json', file: join(root, 'docs', 'datamodel', 'model.json'), label: 'docs/datamodel/model.json' };

  const verify = (ref: string) => {
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd); } catch { throw new InputError(`unknown git ref: ${ref}`); }
  };
  const show = (ref: string): string | null => {
    try { return git(['show', `${ref}:${model.spec}`], cwd); } catch { return null; }
  };

  verify(values.from);
  const fromJson = show(values.from);   // no model at that ref: counts as empty
  const from = fromJson === null ? null : parseModel(fromJson, `${values.from}:${model.label}`);

  if (values.to) {
    verify(values.to);
    const toJson = show(values.to);
    if (toJson === null) throw new InputError(`${values.to} has no ${model.label}`);
    return { from, to: parseModel(toJson, `${values.to}:${model.label}`), refs: { from: values.from, to: values.to } };
  }
  return { from, to: readModelFile(model.file, model.label), refs: { from: values.from, to: 'working tree' } };
}

/** `dv-convert diff …`; returns the exit code. */
export async function runDiff(argv: string[], cwd: string): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(DIFF_USAGE);
    return 0;
  }
  const { values, positionals } = parseDiffArgs(argv);
  if (values.format !== 'json' && values.format !== 'md') throw new UsageError('--format must be json or md');

  const inputs = readInputs(values, positionals, cwd);
  const result = diffModels(inputs.from, inputs.to, inputs.refs);
  const output = values.format === 'json' ? JSON.stringify(result, null, 2) + '\n' : renderMarkdown(result);

  if (values.output) {
    writeFileSync(resolve(cwd, values.output), output, 'utf-8');
    console.error(`Written: ${values.output}`);
  } else {
    console.log(output.replace(/\n$/, ''));
  }
  return values['exit-code'] && result.changes.length > 0 ? 1 : 0;
}
