import path from 'path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const NODE_BUILTINS = new Set([
  'fs', 'path', 'process', 'os', 'url', 'util', 'stream', 'events',
  'child_process', 'crypto', 'http', 'https', 'net', 'readline', 'buffer',
  'string_decoder', 'tty', 'assert', 'perf_hooks', 'worker_threads', 'module',
]);

function shebangPlugin(): Plugin {
  return {
    name: 'add-shebang',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.fileName === 'cli.mjs') {
          chunk.code = '#!/usr/bin/env node\n' + chunk.code;
        }
      }
    },
  };
}

export default defineConfig({
  resolve: {
    // Resolve workspace packages from their built output (not TypeScript source)
    // to avoid @/ alias conflicts from other packages
    alias: {
      '@': path.resolve(__dirname, 'src/'),
    },
    extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
  },
  build: {
    outDir: 'dist',
    lib: {
      entry: path.resolve(__dirname, 'src/cli.ts'),
      formats: ['es'],
      fileName: () => 'cli.mjs',
    },
    rollupOptions: {
      external: (id: string) => {
        if (id.startsWith('node:')) return true;
        const base = id.split('/')[0];
        // External: only Node.js built-in modules
        return NODE_BUILTINS.has(base);
      },
    },
    target: 'node18',
    minify: false,
  },
  plugins: [shebangPlugin()],
});
