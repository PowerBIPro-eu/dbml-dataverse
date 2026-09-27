import { readdirSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import { buildOutputs } from '../src/converter.js';
import { datamodel, filesOf, generatedFiles, layeredOptions } from './helpers.js';

// Directory listings come back in reverse order here — the way NTFS (case-folded) and ext4 (hash
// order) disagree. The output must not change.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const reversed = ((...args: unknown[]) => (fs.readdirSync as any)(...args).reverse()) as typeof fs.readdirSync;
  return { ...fs, readdirSync: reversed, default: { ...fs, readdirSync: reversed } };
});

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

it('produces the same bytes when directories list in another order', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  expect(readdirSync(datamodel)).toEqual(actual.readdirSync(datamodel).reverse());   // the mock is active
  const produced = filesOf(buildOutputs(layeredOptions()));
  for (const [name, content] of generatedFiles(datamodel)) expect(produced.get(name), name).toBe(content);
});
