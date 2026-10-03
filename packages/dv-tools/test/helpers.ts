import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildResult } from '../src/converter.js';
import type { ConvertOptions } from '../src/types.js';

export const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));
export const layered = join(fixtures, 'layered');
export const datamodel = join(layered, 'docs', 'datamodel');
export const configFile = join(datamodel, 'dv-convert.json');
export const coreSolution = join(layered, 'solutions', 'Core');
export const salesSolution = join(layered, 'solutions', 'Sales');

/** The options the layered fixture's dv-convert.json resolves to. */
export function layeredOptions(overrides: Partial<ConvertOptions> = {}): ConvertOptions {
  return {
    solutions: [
      { path: coreSolution, name: 'Core', uniqueName: 'DvtCore' },
      { path: salesSolution, name: 'Sales' },
    ],
    outputDir: datamodel,
    writeDbml: true,
    writeComponents: true,
    colors: JSON.parse(readFileSync(join(datamodel, 'colors.json'), 'utf-8')),
    platformTables: 'with-our-columns',
    configPath: configFile,
    ...overrides,
  };
}

/** Files dv-convert generates in a folder (name → content), in name order. */
export function generatedFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.dv.dbml') || name === 'model.json' || name === 'components.json') {
      files.set(name, readFileSync(join(dir, name), 'utf-8'));
    }
  }
  return files;
}

export function filesOf(result: BuildResult): Map<string, string> {
  return new Map(result.files.map((f) => [f.name, f.content]));
}

export function modelOf(result: BuildResult): any {
  return JSON.parse(filesOf(result).get('model.json')!);
}

export function componentsOf(result: BuildResult): any {
  return JSON.parse(filesOf(result).get('components.json')!);
}
