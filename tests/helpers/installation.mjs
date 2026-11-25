import worker from "../../dist/worker.mjs";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const fixture = readFileSync(new URL("../fixtures/panel-worker.js.gz", import.meta.url));
const reference = JSON.parse(readFileSync(new URL("../fixtures/panel-reference.json", import.meta.url), 'utf8'));
assert.equal(createHash('sha256').update(fixture).digest('hex'), reference.sha256, 'Panel fixture checksum mismatch');
export const panelSource = gunzipSync(fixture).toString();
export const secret = 'test-only-secret-with-at-least-32-characters';
export const token = 'test-cloudflare-token';
const origin = 'https://wizard.example';
export const accountID = 'account-test';
export const assets = { fetch: async () => new Response('HESARI OS assets') };
const json = (result, status = 200) => Response.json({ success: status < 400, result, errors: status >= 400 ? [{ code: 1000, message: 'Test failure' }] : [] }, { status });

export function cloudflareMock({ fresh = false, noAccounts = false, inactive = false, forbidden = false, downloadFailure = false, source = panelSource, providerFailure = false } = {}) {
    const calls = [];
    const uploads = [];
    const projects = [];
    return {
        calls, uploads, projects,
        fetch: async (input, init) => {
            const req = new Request(input, init);
            const url = new URL(req.url);
            calls.push({ method: req.method, url: req.url });
            if (url.hostname === 'github.com') {
                assert.equal(req.url, 'https://github.com/mjhesari/Hesari-Os/releases/latest/download/worker.js');
                return new Response(source, { status: downloadFailure ? 503 : 200 });
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
                    if (providerFailure) return json({ message: token + ' private-password' }, 400);
                    const data = await req.formData();
                    uploads.push({ metadata: JSON.parse(await data.get('metadata').text()), script: await data.get('worker.js').text(), name: path.split('/').at(-1) });
                    return json({ id: 'worker-test' });
                }
                if (path.endsWith('/subdomain')) return json({ enabled: true });
            }
            if (path.endsWith('/pages/projects') && req.method === 'POST') {
                if (providerFailure) return Response.json({ success: false, errors: [{ message: token + ' private-password' }] }, { status: 400 });
                const data = await req.json();
                projects.push(data);
                assert.equal(Object.values(data.deployment_configs.production.kv_namespaces)[0].namespace_id, 'kv-test');
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

export async function deploy(t, options = {}) {
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

