import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.mjs';
import { encrypt, decrypt } from '../.test-build/encryption.js';
import { panelWorkerURL } from '../.test-build/config.js';

const secret = 'test-only-secret-with-at-least-32-characters';
const token = 'test-cloudflare-token';
const origin = 'https://wizard.example';
const accountID = 'account-test';
const assets = { fetch: async () => new Response('HESARI OS assets') };
const json = (result, status = 200) => Response.json({ success: status < 400, result, errors: status >= 400 ? [{ code: 1000, message: 'Test failure' }] : [] }, { status });

function cloudflareMock({ fresh = false, noAccounts = false, inactive = false, forbidden = false, downloadFailure = false } = {}) {
    const calls = [];
    const uploads = [];
    return {
        calls, uploads,
        fetch: async (input, init) => {
            const req = new Request(input, init);
            const url = new URL(req.url);
            calls.push({ method: req.method, url: req.url });
            if (url.hostname === 'github.com') {
                assert.equal(req.url, 'https://github.com/mjhesari/Hesari-Os/releases/latest/download/worker.js');
                return new Response('export default {fetch(){return new Response("HESARI OS")}};', { status: downloadFailure ? 503 : 200 });
            }
            assert.equal(url.hostname, 'api.cloudflare.com');
            assert.equal(req.headers.get('Authorization'), `Bearer ${token}`);
            const path = url.pathname.replace('/client/v4', '');
            if (path === '/user/tokens/verify') return json({ status: inactive ? 'disabled' : 'active' });
            if (path === '/accounts') return json(noAccounts ? [] : [{ id: accountID }]);
            if (path === '/user') return json({ email: 'owner@example.com' });
            if (path.endsWith('/storage/kv/namespaces') && req.method === 'POST') return json({ id: 'kv-test' });
            if (path.endsWith('/workers/subdomain')) {
                if (req.method === 'GET') return fresh ? json(null, 404) : json({ subdomain: 'existing' });
                return json({ subdomain: 'fresh-account' });
            }
            if (path.includes('/workers/scripts/')) {
                if (req.method === 'GET') return json(null, forbidden ? 403 : 404);
                if (req.method === 'PUT') {
                    const data = await req.formData();
                    uploads.push({ metadata: JSON.parse(await data.get('metadata').text()), script: await data.get('worker.js').text(), name: path.split('/').at(-1) });
                    return json({ id: 'worker-test' });
                }
                if (path.endsWith('/subdomain')) return json({ enabled: true });
            }
            if (path.endsWith('/pages/projects') && req.method === 'POST') {
                const data = await req.json();
                assert.equal(data.deployment_configs.production.kv_namespaces.kv.namespace_id, 'kv-test');
                return json({ subdomain: `${data.name}.pages.dev` });
            }
            if (path.includes('/pages/projects/')) {
                if (req.method === 'GET') return json(null, 404);
                if (path.endsWith('/deployments')) {
                    const data = await req.formData();
                    uploads.push({ script: await data.get('_worker.js').text() });
                    return json({ id: 'pages-deploy' });
                }
            }
            throw new Error(`Unmocked request: ${req.method} ${req.url}`);
        }
    };
}

async function deploy(t, options = {}) {
    const mock = cloudflareMock(options);
    t.mock.method(globalThis, 'fetch', mock.fetch);
    const data = new FormData();
    data.set('apiToken', options.emptyToken ? '' : token);
    data.set('deployType', options.deployType || 'workers');
    if (options.privateKey) data.set('privateKey', options.privateKey);
    const req = new Request(`${origin}/api/deploy`, { method: 'POST', headers: { Origin: origin }, body: data });
    const response = await worker.fetch(req, { SECRET: options.secret ?? secret, ASSETS: assets });
    const messages = (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { response, messages, ...mock };
}

for (const fresh of [false, true]) test(`Workers installation with ${fresh ? 'fresh' : 'existing'} account embeds settings and returns a valid URL`, async t => {
    const { response, messages, uploads } = await deploy(t, { fresh });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(messages.some(message => message.type === 'error'), false, JSON.stringify(messages));
    const result = JSON.parse(messages.find(message => message.type === 'complete').message);
    const url = new URL(result.url);
    assert.ok(url.hostname.endsWith(fresh ? '.fresh-account.workers.dev' : '.existing.workers.dev'));
    assert.match(url.pathname, /^\/[\w-]+\/panel$/);
    assert.equal(await decrypt(result.key, secret), token);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].metadata.bindings[0].name, 'kv');
    assert.equal(uploads[0].metadata.bindings[0].namespace_id, 'kv-test');
    const match = uploads[0].script.match(/const EMBEDED_SETTINGS = (\{[^\n]+?\});/);
    const settings = JSON.parse(match[1]);
    assert.equal(settings.accID, accountID);
    assert.equal(settings.apiToken, token);
    assert.equal(settings.securePath, url.pathname.split('/')[1]);
    assert.equal(settings.mainDomain, url.hostname);
    assert.match(settings.vlUUID, /^[\da-f-]{36}$/);
    assert.ok(settings.trPass.length >= 16);
    assert.deepEqual(settings.proxyIPs, []);
});

test('Pages installation binds KV, uploads _worker.js and returns the private panel path', async t => {
    const { messages, uploads } = await deploy(t, { deployType: 'pages' });
    assert.equal(messages.some(message => message.type === 'error'), false, JSON.stringify(messages));
    const result = JSON.parse(messages.find(message => message.type === 'complete').message);
    assert.ok(new URL(result.url).hostname.endsWith('.pages.dev'));
    assert.match(uploads[0].script, /const EMBEDED_SETTINGS/);
});

test('A private installer key can be sent in the POST body without a raw token', async t => {
    const privateKey = await encrypt(token, secret);
    const { messages } = await deploy(t, { privateKey, emptyToken: true });
    assert.ok(messages.some(message => message.type === 'complete'), JSON.stringify(messages));
});

for (const [name, options, expected] of [
    ['missing server secret', { secret: '' }, /not configured/],
    ['empty token', { emptyToken: true }, /Enter a Cloudflare/],
    ['invalid destination', { deployType: 'other' }, /Workers or Pages/],
    ['invalid private key', { privateKey: 'invalid' }, /private link is invalid/],
    ['inactive token', { inactive: true }, /disabled/],
    ['no accounts', { noAccounts: true }, /No Cloudflare account/],
    ['forbidden account resource', { forbidden: true }, /403/],
    ['panel download failure', { downloadFailure: true }, /503/]
]) test(`${name} reports a failure and never reports success`, async t => {
    const { messages, calls } = await deploy(t, options);
    const failure = messages.find(message => message.type === 'error');
    assert.ok(failure, JSON.stringify(messages));
    assert.match(failure.message, expected);
    assert.equal(messages.some(message => message.type === 'complete'), false);
    assert.equal(calls.some(call => call.method === 'PUT'), false);
    if (['missing server secret', 'empty token', 'invalid destination', 'invalid private key'].includes(name)) assert.equal(calls.length, 0);
});

test('Cross-origin and missing-origin installation requests are rejected before accessing Cloudflare', async t => {
    const spy = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
    for (const headers of [{ Origin: 'https://other.example' }, {}]) {
        const response = await worker.fetch(new Request(`${origin}/api/deploy`, { method: 'POST', headers }), { SECRET: secret, ASSETS: assets });
        assert.equal(response.status, 403);
    }
    assert.equal(spy.mock.callCount(), 0);
});

test('The home page is served with private-link referrer and cache protections', async () => {
    const response = await worker.fetch(new Request(origin), { ASSETS: assets });
    assert.equal(await response.text(), 'HESARI OS assets');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('Private keys use authenticated encryption, reject tampering and changed secrets', async () => {
    const first = await encrypt(token, secret);
    const second = await encrypt(token, secret);
    assert.notEqual(first, second);
    assert.equal(await decrypt(first, secret), token);
    const bytes = Buffer.from(first, 'base64');
    bytes[15] ^= 1;
    await assert.rejects(decrypt(bytes.toString('base64'), secret), /invalid/);
    await assert.rejects(decrypt(first, secret + 'changed'), /invalid/);
    await assert.rejects(encrypt(token, ''), /not configured/);
});

test('Preview releases resolve from the HESARI OS release feed and skip drafts', async t => {
    t.mock.method(globalThis, 'fetch', async input => {
        assert.equal(input, 'https://api.github.com/repos/mjhesari/Hesari-Os/releases');
        return Response.json([
            { draft: true, assets: [{ name: 'worker.js', browser_download_url: 'https://bad.example' }] },
            { draft: false, assets: [{ name: 'worker.js', browser_download_url: 'https://github.com/mjhesari/Hesari-Os/releases/download/v5.2.0-beta/worker.js' }] }
        ]);
    });
    assert.match(await panelWorkerURL(true), /v5\.2\.0-beta\/worker.js$/);
});
