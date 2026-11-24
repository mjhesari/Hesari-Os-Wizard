import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['web/src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/worker.mjs' });
await build({ entryPoints: ['web/src/encryption.ts', 'web/src/script.ts', 'web/src/config.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: '.test-build' });
