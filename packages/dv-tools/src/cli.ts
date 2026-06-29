import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convert, convertSingleEntity } from './converter.js';

const USAGE = `
dv-convert — Dataverse solution XML → .dv.dbml + model.json

Usage:
  dv-convert <solution-path> [solution-path ...] --output <dir> [options]
  dv-convert <Entity.xml>    --output <dir>  (single entity mode)

Options:
  --output, -o <dir>           Output directory (required)
  --colors <file>              JSON file mapping entity names to hex header colors
  --solution-names <n1,n2,...> Override solution names (comma-separated, matches order of paths)
  --no-dbml                    Skip writing .dv.dbml files (only write model.json)
  --help, -h                   Show this help

Examples:
  dv-convert ./MySolution --output ./datamodel
  dv-convert ./CoreSolution ./SalesModule ./ServiceModule --output ./datamodel
  dv-convert ./CoreSolution ./SalesModule --output ./out --solution-names Core,Sales
  dv-convert ./MySolution --output ./datamodel --colors colors.json
  dv-convert ./src/Entities/ddsol_svc_ticket/Entity.xml --output ./out
`.trim();

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        output:           { type: 'string', short: 'o' },
        colors:           { type: 'string' },
        'solution-names': { type: 'string' },
        'no-dbml':        { type: 'boolean', default: false },
        help:             { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err: any) {
    console.error('Error:', err.message);
    console.error('Run with --help for usage information.');
    process.exit(1);
  }

  const inputPaths = parsed.positionals;
  const outputDir = parsed.values.output;

  if (!inputPaths.length) {
    console.error('Error: no input path provided.\n');
    console.error(USAGE);
    process.exit(1);
  }
  if (!outputDir) {
    console.error('Error: --output is required.\n');
    console.error(USAGE);
    process.exit(1);
  }

  // Validate all paths exist
  for (const p of inputPaths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      console.error(`Error: path not found: ${abs}`);
      process.exit(1);
    }
  }

  // Load color map
  let colors: Record<string, string> = {};
  if (parsed.values.colors) {
    const colorsPath = resolve(parsed.values.colors as string);
    if (existsSync(colorsPath)) {
      try {
        colors = JSON.parse(readFileSync(colorsPath, 'utf-8'));
      } catch (e: any) {
        console.error(`Warning: could not load colors file: ${e.message}`);
      }
    } else {
      console.error(`Warning: colors file not found: ${colorsPath}`);
    }
  }

  const writeDbml = !(parsed.values['no-dbml'] as boolean);

  // Parse optional solution-names override
  let solutionNames: string[] | undefined;
  const namesArg = parsed.values['solution-names'] as string | undefined;
  if (namesArg) {
    solutionNames = namesArg.split(',').map(s => s.trim()).filter(Boolean);
    if (solutionNames.length !== inputPaths.length) {
      console.error(`Error: --solution-names has ${solutionNames.length} entries but ${inputPaths.length} paths were given.`);
      process.exit(1);
    }
  }

  // Detect single entity XML vs solution directory (only valid for a single path)
  const absFirst = resolve(inputPaths[0]);
  const isSingleEntity = inputPaths.length === 1 &&
    absFirst.endsWith('.xml') && absFirst.toLowerCase().includes('entity');

  if (isSingleEntity) {
    await convertSingleEntity(absFirst, outputDir);
  } else {
    const input = inputPaths.length === 1 ? inputPaths[0] : inputPaths;
    await convert(input, { outputDir, writeDbml, colors, solutionNames });
  }

  console.error('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err?.message ?? err);
  process.exit(1);
});
