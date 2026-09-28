import { readdirSync } from 'node:fs';
import { relative, sep } from 'node:path';

/** Locale-independent string order (UTF-16 code units): the same on every OS and Node version. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Directory entries sorted by name; raw readdir order differs between NTFS (case-folded) and ext4 (hash). */
export function listDir(path: string, kind: 'files' | 'dirs'): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => (kind === 'dirs' ? entry.isDirectory() : entry.isFile()))
    .map((entry) => entry.name)
    .sort(compareStrings);
}

/** Relative path with forward slashes, so generated files are identical on Windows and Linux. */
export function portableRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join('/') || '.';
}
