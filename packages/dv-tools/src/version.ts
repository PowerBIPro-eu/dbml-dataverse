// Replaced with the package.json version at build time (vite.config.ts `define`).
declare const __DV_TOOLS_VERSION__: string | undefined;

/** dv-tools version; '0.0.0-dev' when running unbuilt sources (e.g. vitest). */
export const VERSION: string = typeof __DV_TOOLS_VERSION__ === 'string' ? __DV_TOOLS_VERSION__ : '0.0.0-dev';
