import { readFileSync } from 'node:fs';

// Replaced with the package.json version at build time (vite.config.ts `define`).
declare const __DV_TOOLS_VERSION__: string | undefined;

/** Unbuilt sources (vitest): read the version from package.json next to src/. */
function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
  } catch {
    return '0.0.0-dev';
  }
}

/** dv-tools version, e.g. printed by `dv-convert --version` and recorded in model.json provenance. */
export const VERSION: string = typeof __DV_TOOLS_VERSION__ === 'string' ? __DV_TOOLS_VERSION__ : packageVersion();
