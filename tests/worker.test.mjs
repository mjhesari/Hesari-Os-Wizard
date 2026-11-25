import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.mjs';
import { encrypt, decrypt } from '../.test-build/encryption.js';
import { panelWorkerURL } from '../.test-build/config.js';

import { deploy, accountID, token, secret, panelSource, assets } from './helpers/installation.mjs';
import { parseWorkerBundle, unpackSource } from '../shared/worker-bundle.js';
const origin = 'https://wizard.example';

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
    const bundle = parseWorkerBundle(uploads[0].script);
    assert.equal(uploads[0].metadata.bindings[0].name, bundle.profile.kvBinding);
    assert.equal(await unpackSource(bundle.source), uploads[0].script.split('\n').slice(1).join('\n'));
    assert.equal(uploads[0].metadata.bindings[0].namespace_id, 'kv-test');
    const settings = bundle.config;
    assert.equal(settings.accID, accountID);
    assert.equal(settings.apiToken, token);
    assert.equal(settings.securePath, url.pathname.split('/')[1]);
    assert.equal(settings.mainDomain, url.hostname);
    assert.match(settings.vlUUID, /^[\da-f-]{36}$/);
    assert.ok(settings.trPass.length >= 16);
    assert.deepEqual(settings.proxyIPs, []);
});

test('Pages installation binds KV, uploads _worker.js and returns the private panel path', async t => {
    const { messages, uploads, projects } = await deploy(t, { deployType: 'pages' });
    assert.equal(messages.some(message => message.type === 'error'), false, JSON.stringify(messages));
    const result = JSON.parse(messages.find(message => message.type === 'complete').message);
    assert.ok(new URL(result.url).hostname.endsWith('.pages.dev'));
    const bundle = parseWorkerBundle(uploads[0].script);
    assert.deepEqual(Object.keys(projects[0].deployment_configs.production.kv_namespaces), [bundle.profile.kvBinding]);
    assert.equal(bundle.config.mainDomain, new URL(result.url).hostname);
});

function mutateBundle(role, value) {
    const end = panelSource.indexOf('\n');
    const values = JSON.parse(panelSource.slice('Object.assign(globalThis,'.length, end - 2));
    const { profile } = parseWorkerBundle(panelSource);
    values[profile.names[role]] = value;
    return `Object.assign(globalThis,${JSON.stringify(values)});${panelSource.slice(end)}`;
}

for (const deployType of ['workers', 'pages']) {
    for (const [name, source] of [
        ['legacy', 'const EMBEDED_SETTINGS = {}; export default {};'],
        ['HTML', '<html>private-test-token</html>'],
        ['truncated', panelSource.slice(0, -10)],
        ['asset gzip', panelSource.replace(/H4sI[A-Za-z0-9+/=]+/, 'invalid-gzip')],
        ['source gzip', mutateBundle('source', 'invalid-gzip-private-test-token')],
        ['profile version', mutateBundle('profile', { ...parseWorkerBundle(panelSource).profile, format: 2 })],
        ['fixed binding', mutateBundle('profile', { ...parseWorkerBundle(panelSource).profile, kvBinding: 'kv' })]
    ]) test(`${deployType} rejects ${name} bundles before upload`, async t => {
        const { messages, uploads, projects } = await deploy(t, { deployType, source });
        const failure = messages.find(message => message.type === 'error');
        assert.match(failure?.message, /Incompatible or corrupt panel worker bundle/);
        assert.doesNotMatch(failure.message, /private-test-token/);
        assert.equal(uploads.length, 0);
        assert.equal(projects.length, 0);
        assert.equal(messages.some(message => message.type === 'complete'), false);
    });
}

for (const deployType of ['workers', 'pages']) test(`${deployType} provider deployment errors do not echo credentials`, async t => {
    const { messages } = await deploy(t, { providerFailure: true, deployType });
    assert.match(messages.find(message => message.type === 'error').message, /400/);
    assert.doesNotMatch(JSON.stringify(messages), /test-cloudflare-token|private-password/);
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
    const response = await worker.fetch(new Request(origin), { ASSETS: { fetch: async request => {
        assert.ok(request instanceof Request, 'Asset bindings must receive a Request');
        assert.equal(new URL(request.url).pathname, '/');
        return new Response('HESARI OS assets');
    } } });
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
