import { test, expect } from '@playwright/test';

const complete = { url: 'https://example.owner.workers.dev/private-panel/panel', user: 'owner@example.com', key: 'test-encrypted-key+/=' };
const ndjson = values => values.map(value => JSON.stringify(value)).join('\n');
async function installation(page, messages, status = 200) {
    await page.route('**/api/deploy*', route => route.fulfill({ status, contentType: 'application/x-ndjson', body: ndjson(messages) }));
}
test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('Brand, accessible inputs, destinations and CLI tabs work without overflow', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page).toHaveTitle('HESARI OS · Deployment workspace');
    await expect(page.getByRole('heading', { name: 'Build. Manage. Evolve.' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Your workspace' })).toBeHidden();
    await page.getByLabel('Cloudflare API token').fill('test-only-token');
    await page.getByRole('button', { name: 'Show token', exact: true }).click();
    await expect(page.getByLabel('Cloudflare API token')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide token', exact: true }).click();
    await page.getByRole('radio', { name: /Pages/ }).check();
    await expect(page.locator('#destinationLabel')).toHaveText('DESTINATION / PAGES');
    await page.getByRole('tab', { name: 'Windows', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toContainText('install.ps1 | iex');
    await page.getByRole('tab', { name: 'Windows', exact: true }).press('ArrowLeft');
    await expect(page.getByRole('tabpanel')).toContainText('install.sh');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('Successful stream opens the panel and copies a private link using a fragment', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installation(page, [{ type: 'success', message: 'KV namespace created successfully!' }, { type: 'complete', message: JSON.stringify(complete) }]);
    await page.goto('/');
    await page.getByLabel('Cloudflare API token').fill('test-only-token');
    await page.getByRole('button', { name: 'Install HESARI OS', exact: true }).click();
    await expect(page.locator('#deploymentStatus')).toHaveText('Installed');
    await expect(page.getByRole('link', { name: 'Open HESARI OS', exact: true })).toHaveAttribute('href', complete.url);
    await expect(page.locator('#accountBanner')).toContainText(complete.user);
    await expect(page.getByLabel('Cloudflare API token')).toBeHidden();
    await page.getByRole('button', { name: 'Copy private installer link' }).click();
    const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(copied.searchParams.has('key')).toBe(false);
    expect(new URLSearchParams(copied.hash.slice(1)).get('key')).toBe(complete.key);
    await page.getByRole('button', { name: 'Copy panel link' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(complete.url);
});

test('Private links send their key only in the POST body and can change account', async ({ page }) => {
    let request;
    await page.route('**/api/deploy*', async route => {
        request = route.request();
        await route.fulfill({ contentType: 'application/x-ndjson', body: ndjson([{ type: 'error', message: 'This private link is invalid.' }]) });
    });
    await page.goto('/#' + new URLSearchParams({ key: complete.key, user: complete.user }));
    await expect(page.locator('#user')).toHaveText(complete.user);
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
    await page.getByRole('button', { name: 'Install HESARI OS', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('private link is invalid');
    expect(request.url()).not.toContain('key=');
    expect(request.postData()).toContain('name="privateKey"');
    expect(request.postData()).toContain(complete.key);
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(page.getByLabel('Cloudflare API token')).toBeVisible();
    await expect(page.getByLabel('Cloudflare API token')).toHaveValue('');
});

for (const scenario of ['http', 'truncated', 'server', 'malformed']) test(`${scenario} failure is visible and allows retry`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installation(page, scenario === 'server' ? [{ type: 'error', message: 'Token permissions are missing.' }] : [{ type: 'info', message: 'Connecting…' }], scenario === 'http' ? 503 : 200);
    if (scenario === 'malformed') await page.route('**/api/deploy*', route => route.fulfill({ body: 'not-json', contentType: 'application/x-ndjson' }));
    await page.goto('/');
    await page.getByLabel('Cloudflare API token').fill('test-only-token');
    await page.getByRole('button', { name: 'Install HESARI OS', exact: true }).click();
    await expect(page.locator('#deploymentStatus')).toHaveText('Failed');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install HESARI OS', exact: true })).toBeEnabled();
    await expect(page.locator('#deploymentResult')).toBeHidden();
    expect(errors).toEqual([]);
});

test('Repeated clicks during a deployment send only one request', async ({ page }) => {
    let count = 0;
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    await page.route('**/api/deploy*', async route => {
        count++;
        await gate;
        await route.fulfill({ contentType: 'application/x-ndjson', body: ndjson([{ type: 'error', message: 'Test finished.' }]) });
    });
    await page.goto('/');
    await page.getByLabel('Cloudflare API token').fill('test-only-token');
    await page.getByRole('button', { name: 'Install HESARI OS', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Installing your workspace…' })).toBeDisabled();
    expect(count).toBe(1);
    finish();
    await expect(page.locator('#deploymentStatus')).toHaveText('Failed');
});


test('Real Worker runtime serves assets and rejects cross-origin installs', async ({ request }) => {
    const home = await request.get('/');
    expect(home.status()).toBe(200);
    expect(await home.text()).toContain('HESARI OS');
    expect(home.headers()['referrer-policy']).toBe('no-referrer');
    expect(home.headers()['cache-control']).toBe('no-store');
    for (const [path, type] of [['/styles.css', 'text/css'], ['/app.js', 'javascript'], ['/favicon.svg', 'image/svg+xml']]) {
        const asset = await request.get(path);
        expect(asset.status()).toBe(200);
        expect(asset.headers()['content-type']).toContain(type);
    }
    const missing = await request.get('/missing-file.txt');
    expect(missing.status()).toBe(404);
    const rejected = await request.post('/api/deploy', { headers: { Origin: 'https://other.example' } });
    expect(rejected.status()).toBe(403);
});
