import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse, Log, LogLevel } from 'miniflare';
import { cloudflareMock, panelSource, secret, token } from './helpers/installation.mjs';
import { parseWorkerBundle, unpackSource } from '../shared/worker-bundle.js';

async function webInstallation(kind) {
    const mock = cloudflareMock();
    const wizard = new Miniflare(convertV4MiniflareOptions({
        modules: true, script: readFileSync(new URL('../dist/worker.mjs', import.meta.url), 'utf8'),
        compatibilityDate: '2026-07-17', bindings: { SECRET: secret }, log: new Log(LogLevel.NONE),
        outboundService: async request => {
            const response = await mock.fetch(request.url, {
                method: request.method, headers: [...request.headers],
                ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: await request.arrayBuffer() })
            });
            return new RuntimeResponse(await response.arrayBuffer(), { status: response.status, headers: [...response.headers] });
        }
    }));
    try {
        const data = new FormData();
        data.set('apiToken', token);
        data.set('deployType', kind);
        const request = new Request('https://wizard.example/api/deploy', {
            method: 'POST', headers: { Origin: 'https://wizard.example' }, body: data
        });
        const response = await wizard.dispatchFetch(request.url, {
            method: request.method, headers: [...request.headers], body: await request.arrayBuffer()
        });
        const messages = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
        assert.ok(messages.some(message => message.type === 'complete'), JSON.stringify(messages));
        return mock;
    } finally {
        await wizard.dispose();
    }
}

test('all four Wizard uploads run, authenticate, generate subscriptions and survive save/update with existing KV', { timeout: 180_000 }, async t => {
    const output = mkdtempSync(join(tmpdir(), 'wizard-runtime-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    execFileSync('go', ['test', './internal', '-run', '^TestCLIDeployments$', '-count=1'], {
        env: { ...process.env, WIZARD_RUNTIME_OUTPUT: output }, timeout: 60_000, stdio: 'pipe'
    });
    const profiles = [];
    for (const client of ['web', 'cli']) for (const kind of ['workers', 'pages']) {
        await t.test(`${client} → ${kind}`, async t => {
            let script;
            if (client === 'web') {
                const installed = await webInstallation(kind);
                script = installed.uploads[0].script;
                const binding = kind === 'workers' ? installed.uploads[0].metadata.bindings[0].name
                    : Object.keys(installed.projects[0].deployment_configs.production.kv_namespaces)[0];
                assert.equal(binding, parseWorkerBundle(script).profile.kvBinding);
            } else {
                script = readFileSync(join(output, `cli-${kind}.js`), 'utf8');
            }
            const { profile, config } = parseWorkerBundle(script);
            profiles.push(profile);
            const base = `https://${config.mainDomain}/${config.securePath}`;
            const uploads = [];
            const outboundService = async request => {
                const url = new URL(request.url);
                if (url.hostname === 'cloudflare-dns.com') return RuntimeResponse.json({ Status: 0, Answer: [{ type: 1, data: '104.16.1.1' }] });
                if (url.hostname === 'github.com' && url.pathname.endsWith('/worker.js')) return new RuntimeResponse(panelSource);
                if (url.hostname === 'api.cloudflare.com') {
                    const expectedPath = kind === 'workers'
                        ? `/client/v4/accounts/${config.accID}/workers/scripts/${config.mainDomain.split('.')[0]}`
                        : `/client/v4/accounts/${config.accID}/pages/projects/${config.mainDomain.split('.')[0]}/deployments`;
                    assert.equal(url.pathname, expectedPath);
                    assert.equal(request.method, kind === 'workers' ? 'PUT' : 'POST');
                    const form = await request.formData();
                    if (kind === 'workers') {
                        const metadata = JSON.parse(await form.get('metadata').text());
                        assert.deepEqual(metadata.keep_bindings, ['kv_namespace']);
                        assert.equal(metadata.bindings, undefined, 'updates must retain the existing namespace ID');
                    } else {
                        assert.equal(form.get('manifest'), '{}');
                    }
                    uploads.push(await form.get(kind === 'workers' ? 'worker.js' : '_worker.js').text());
                    return RuntimeResponse.json({ success: true });
                }
                throw new Error(`Unexpected provider: ${url.hostname}${url.pathname}`);
            };
            const options = {
                modules: true, compatibilityDate: '2026-06-03', compatibilityFlags: ['nodejs_compat'],
                kvNamespaces: [profile.kvBinding], resourcePersistencePath: join(output, `${client}-${kind}-kv`),
                bindings: kind === 'pages' ? { CF_PAGES: '1' } : {}, outboundService,
                log: new Log(LogLevel.NONE)
            };
            let mf = new Miniflare(convertV4MiniflareOptions({ ...options, script }));
            t.after(() => mf.dispose());
            let kv = await mf.getKVNamespace(profile.kvBinding);
            await kv.put('installation-marker', `${client}-${kind}`);
            await kv.put('proxySettings', JSON.stringify({ panelVersion: '5.1.2', bestPingInterval: 55 }));
            await kv.put('warpAccounts', JSON.stringify([1, 2].map(value => ({
                privateKey: Buffer.alloc(32, value).toString('base64'), publicKey: Buffer.alloc(32, 5).toString('base64'),
                warpIPv6: `2606:4700:110::${value}/128`, reserved: 'N16D'
            }))));
            let cookie;
            const request = (path, method = 'GET', body) => mf.dispatchFetch(`${base}/${path}`, {
                method, redirect: 'manual', headers: {
                    ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {})
                }, ...(body ? { body: JSON.stringify(body) } : {})
            });
            const assertUsable = async password => {
                const response = await request('panel/settings');
                assert.equal(response.status, 200, 'existing session must work with existing KV');
                const settings = (await response.json()).body.proxySettings;
                assert.equal(settings.vlUUID, config.vlUUID);
                assert.equal(settings.trPass, password);
                assert.equal(settings.bestPingInterval, 55);
                assert.equal(settings.apiToken, undefined);
                const subscription = await request('sub/raw?app=xray');
                assert.equal(subscription.status, 200);
                const links = Buffer.from(await subscription.text(), 'base64').toString();
                const urls = links.trim().split('\n').map(link => new URL(link));
                assert.ok(urls.some(url => url.protocol === 'vless:' && decodeURIComponent(url.username) === config.vlUUID));
                assert.ok(urls.some(url => url.protocol === 'trojan:' && decodeURIComponent(url.username) === password));
                assert.equal(await kv.get('installation-marker'), `${client}-${kind}`);
                return settings;
            };
            const restartUploaded = async password => {
                const uploaded = uploads.at(-1);
                const parsed = parseWorkerBundle(uploaded);
                assert.deepEqual(parsed.profile, profile);
                assert.equal(await unpackSource(parsed.source), uploaded.slice(uploaded.indexOf('\n') + 1));
                await mf.dispose();
                mf = new Miniflare(convertV4MiniflareOptions({ ...options, script: uploaded }));
                kv = await mf.getKVNamespace(profile.kvBinding);
                await assertUsable(password);
                assert.equal(JSON.parse(await kv.get('proxySettings')).bypassIran, true);
            };

            assert.equal((await request('panel/settings')).status, 401);
            assert.equal((await request('panel/reset-password', 'POST', { username: config.accEmail, password: 'LocalPassword!123' })).status, 200);
            assert.equal((await request('login/authenticate', 'POST', { username: config.accEmail, password: 'wrong' })).status, 401);
            const login = await request('login/authenticate', 'POST', { username: config.accEmail, password: 'LocalPassword!123' });
            assert.equal(login.status, 200);
            cookie = login.headers.get('set-cookie').split(';')[0];
            const settings = await assertUsable(config.trPass);
            const saved = await request('panel/update-settings', 'PUT', { ...settings, bypassIran: true, trPass: 'changed-test-password' });
            assert.equal(saved.status, 200);
            assert.equal(uploads.length, 1);
            await restartUploaded('changed-test-password');
            const update = await request('panel/update-panel', 'POST');
            assert.equal(update.status, 200);
            assert.equal(uploads.length, 2);
            await restartUploaded('changed-test-password');
        });
    }
    const identifiers = profiles.flatMap(profile => [profile.kvBinding, ...Object.values(profile.names)]);
    assert.equal(new Set(identifiers).size, identifiers.length, 'independent installations must have distinct identifiers');
    for (const name of identifiers) {
        assert.match(name, /^[a-z][a-f0-9]{24}$/);
        assert.doesNotMatch(name, /hesari|bpb/i);
    }
});
