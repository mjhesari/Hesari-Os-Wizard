import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseWorkerBundle, unpackSource } from '../shared/worker-bundle.js';

const root = resolve(process.argv[2] || '../BPB-Worker-Panel');
const worker = readFileSync(join(root, 'dist/worker.js'), 'utf8');
const bundle = parseWorkerBundle(worker);
if (bundle.config !== undefined) throw new Error('Refusing to save a personalized worker containing credentials. Build a clean Panel release first.');
if (await unpackSource(bundle.source) !== worker.slice(worker.indexOf('\n') + 1)) throw new Error('Panel bundle source mismatch.');
for (const file of ['worker-bundle.js', 'worker-bundle.d.ts']) {
    if (!readFileSync(join(root, 'src/common', file)).equals(readFileSync(new URL(`../shared/${file}`, import.meta.url)))) {
        throw new Error(`Update and review shared/${file} and the Go implementation before refreshing this fixture.`);
    }
}
const compressed = gzipSync(worker, { level: 9 });
writeFileSync(new URL('../tests/fixtures/panel-worker.js.gz', import.meta.url), compressed);
writeFileSync(new URL('../tests/fixtures/panel-reference.json', import.meta.url), JSON.stringify({
    repository: 'https://github.com/mjhesari/Hesari-Os',
    revision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    sha256: createHash('sha256').update(compressed).digest('hex')
}, null, 2) + '\n');
