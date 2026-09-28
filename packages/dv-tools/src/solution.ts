import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { SolutionInfo } from './types.js';
import { UsageError } from './errors.js';
import { getLabel1033 } from './xml/utils.js';

// ── Path resolution ────────────────────────────────────────────────────────

export interface SolutionPaths {
  entitiesPath: string;
  optionSetsPath: string | null;
  globalRelsPath: string | null;
  solutionXmlPath: string | null;
}

function existing(path: string): string | null {
  return existsSync(path) ? path : null;
}

/** Locate Entities/OptionSets/Relationships/Solution.xml in an unpacked solution folder. */
export function resolvePaths(inputPath: string): SolutionPaths {
  const abs = resolve(inputPath);

  // Common solution layouts: <root>/src/... (pac solution project) or <root>/...
  for (const root of [join(abs, 'src'), abs]) {
    const entities = join(root, 'Entities');
    if (existsSync(entities)) {
      return {
        entitiesPath: entities,
        optionSetsPath: existing(join(root, 'OptionSets')),
        globalRelsPath: existing(join(root, 'Other', 'Relationships')),
        solutionXmlPath: existing(join(root, 'Other', 'Solution.xml')),
      };
    }
  }

  // User pointed directly at an Entities folder
  if (basename(abs) === 'Entities' && existsSync(abs)) {
    const parent = dirname(abs);
    return {
      entitiesPath: abs,
      optionSetsPath: existing(join(parent, 'OptionSets')),
      globalRelsPath: existing(join(parent, 'Other', 'Relationships')),
      solutionXmlPath: existing(join(parent, 'Other', 'Solution.xml')),
    };
  }

  throw new UsageError(`Could not find an Entities folder under: ${abs}`);
}

// ── Solution.xml ───────────────────────────────────────────────────────────

// Values stay strings: a Version of "1.0" must not become the number 1.
const solutionParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name: string) => name === 'LocalizedName',
});

const NO_SOLUTION_INFO: SolutionInfo = { uniqueName: null, displayName: null, version: null, publisher: null };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Read UniqueName, display name, Version and publisher prefixes from Other/Solution.xml. */
export function readSolutionXml(path: string | null): SolutionInfo {
  if (!path) return NO_SOLUTION_INFO;
  let doc: any;
  try { doc = solutionParser.parse(readFileSync(path, 'utf-8')); } catch { return NO_SOLUTION_INFO; }

  const manifest = doc?.ImportExportXml?.SolutionManifest;
  if (!manifest) return NO_SOLUTION_INFO;

  const publisher = manifest.Publisher;
  const optionValuePrefix = parseInt(text(publisher?.CustomizationOptionValuePrefix) ?? '', 10);
  return {
    uniqueName: text(manifest.UniqueName),
    displayName: text(getLabel1033(manifest.LocalizedNames?.LocalizedName)),
    version: text(manifest.Version),
    publisher: publisher ? {
      uniqueName: text(publisher.UniqueName),
      customizationPrefix: text(publisher.CustomizationPrefix),
      optionValuePrefix: Number.isNaN(optionValuePrefix) ? null : optionValuePrefix,
    } : null,
  };
}
