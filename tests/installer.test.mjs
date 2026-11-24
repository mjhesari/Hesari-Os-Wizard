import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const installer = resolve('install.sh');

async function fixture(t, { checksumFailure = false, downloadFailure = false } = {}) {
    const cwd = await mkdtemp(join(tmpdir(), 'hesari-installer-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const bin = join(cwd, 'test-bin');
    const source = join(cwd, 'fixture');
    const unpacked = join(source, 'unpacked');
    await mkdir(bin);
    await mkdir(unpacked, { recursive: true });
    const executable = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v3.1.0; exit 0; fi\nprintf "%s" "$LAUNCHED_BY_SCRIPT" > ../launched.txt\n';
    await writeFile(join(unpacked, 'wizard'), executable, { mode: 0o755 });
    await writeFile(join(unpacked, 'LICENSE'), 'GPL-3.0 test fixture');
    const archive = 'HESARI-Wizard-linux-arm64.tar.gz';
    execFileSync('tar', ['czf', join(source, archive), '-C', unpacked, '.']);
    const checksum = createHash('sha256').update(await readFile(join(source, archive))).digest('hex');
    await writeFile(join(source, 'SHA256SUMS'), `${checksumFailure ? 'bad-checksum' : checksum}  ${archive}\n`);
    await writeFile(join(source, 'worker.js'), 'export default {}; // HESARI OS fixture');
    await writeFile(join(bin, 'uname'), '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo aarch64; fi\n', { mode: 0o755 });
    await writeFile(join(bin, 'curl'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const url = args.at(-1);
fs.appendFileSync(path.join(process.env.HESARI_TEST_FIXTURES, 'requests'), url + '\\n');
if (process.env.HESARI_TEST_FAIL_WORKER && url.endsWith('/worker.js')) process.exit(22);
const body = url.endsWith('/VERSION') ? 'v3.1.0\\n' : fs.readFileSync(path.join(process.env.HESARI_TEST_FIXTURES, url.split('/').at(-1)));
const output = args.indexOf('-o');
if (output >= 0) fs.writeFileSync(args[output + 1], body); else process.stdout.write(body);
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HESARI_TEST_FIXTURES: source, HESARI_TEST_FAIL_WORKER: downloadFailure ? '1' : '' };
    return { cwd, source, env, run: () => spawnSync('bash', [installer], { cwd, env, encoding: 'utf8' }) };
}

test('The Unix installer downloads our release, checks its checksum, downloads HESARI OS and launches', async t => {
    const f = await fixture(t);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(f.cwd, 'launched.txt'), 'utf8'), '1');
    assert.match(await readFile(join(f.cwd, 'hesari-wizard/worker.js'), 'utf8'), /HESARI OS/);
    const urls = await readFile(join(f.source, 'requests'), 'utf8');
    assert.match(urls, /mjhesari\/Hesari-Os-Wizard\/releases\/download\/v3.1.0\/HESARI-Wizard-linux-arm64/);
    assert.match(urls, /mjhesari\/Hesari-Os\/releases\/latest\/download\/worker.js/);
    assert.doesNotMatch(urls, /bia-pain-bache/);
    await rm(join(f.cwd, 'launched.txt'));
    await writeFile(join(f.source, 'requests'), '');
    assert.equal(f.run().status, 0);
    const second = await readFile(join(f.source, 'requests'), 'utf8');
    assert.doesNotMatch(second, /SHA256SUMS|\.tar\.gz/);
    assert.match(second, /worker.js/);
});

test('A checksum mismatch never installs or launches the downloaded binary', async t => {
    const f = await fixture(t, { checksumFailure: true });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /checksum did not match/);
    await assert.rejects(readFile(join(f.cwd, 'launched.txt')));
    await assert.rejects(readFile(join(f.cwd, 'hesari-wizard/wizard')));
});

test('A failed panel download does not launch the wizard or overwrite an existing panel file', async t => {
    const f = await fixture(t, { downloadFailure: true });
    await mkdir(join(f.cwd, 'hesari-wizard'));
    await writeFile(join(f.cwd, 'hesari-wizard/worker.js'), 'previous panel');
    const result = f.run();
    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(join(f.cwd, 'launched.txt')));
    assert.equal(await readFile(join(f.cwd, 'hesari-wizard/worker.js'), 'utf8'), 'previous panel');
});
