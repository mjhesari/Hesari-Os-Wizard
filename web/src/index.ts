import type { CFAccount } from "./api";
import { decrypt, encrypt, validateSecret } from "./encryption";
import { randSubdomain } from "./random";
import { createStreamLogger, StreamLogger } from "./logger";
import { APIError } from 'cloudflare';

export interface Env {
    SECRET: string;
    ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
    async fetch(request: Request, env: Env) {
        const url = new URL(request.url);

        if (url.pathname === '/api/deploy' && request.method === 'POST') {
            const origin = request.headers.get('Origin');
            if (origin !== url.origin) {
                return new Response('Unauthorized context', { status: 403 });
            }

            const logger = createStreamLogger();
            const { readable, success, info, error, close } = logger;

            (async () => {
                try {
                    const key = url.searchParams.get('key');
                    const preRelease = url.searchParams.get('pre-release') === 'true';
                    validateSecret(env.SECRET);
                    const formData = await request.formData();
                    const privateKey = formData.get('privateKey')?.toString() || key;
                    const apiToken = privateKey ? await decrypt(privateKey, env.SECRET) : formData.get('apiToken')?.toString().trim() ?? '';
                    const deployType = formData.get('deployType')?.toString() || 'workers';
                    if (!apiToken) throw new Error('Enter a Cloudflare API token.');
                    if (!['workers', 'pages'].includes(deployType)) throw new Error('Choose Workers or Pages.');
                    const { CFAccount } = await import('./api');
                    const account = await CFAccount.create(apiToken);

                    let workerName: string;
                    do {
                        workerName = randSubdomain();
                    } while (await account.nameTaken(deployType, workerName));

                    info('Installing HESARI OS...');
                    const namespaceId = await account.createKvNamespace(workerName, deployType);
                    success('KV namespace created successfully!');

                    if (deployType === 'pages') {
                        await deployPages(env, account, workerName, namespaceId, logger, preRelease);
                    } else {
                        await deployWorkers(env, account, workerName, namespaceId, logger, preRelease);
                    }
                } catch (err) {
                    const message = err instanceof APIError
                        ? `Cloudflare request failed${err.status ? ` (HTTP ${err.status})` : ''}.`
                        : err instanceof Error ? err.message : 'Unexpected installation error.';
                    error(`Could not install HESARI OS: ${message}`);
                } finally {
                    close();
                }
            })();

            return new Response(readable, {
                headers: {
                    'Content-Type': 'application/x-ndjson',
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
        }

        if (url.pathname === '/') {
            const response = await env.ASSETS.fetch(request);
            const headers = new Headers(response.headers);
            headers.set('Referrer-Policy', 'no-referrer');
            headers.set('Cache-Control', 'no-store');
            return new Response(response.body, { status: response.status, headers });
        }

        return env.ASSETS.fetch(request);
    }
};

async function deployPages(
    env: Env,
    account: CFAccount,
    workerName: string,
    namespaceId: string,
    logger: StreamLogger,
    preRelease: boolean,
) {
    const { success, complete } = logger;

    const { buildScript } = await import('./script');
    const { script, path, kvBinding } = await buildScript(account, workerName, 'pages.dev', '_worker.js', preRelease);
    success('Script built successfully!');

    const subdomain = await account.createPagesProject(workerName, namespaceId, kvBinding);
    success('Pages project created successfully!');

    await account.deployPages(workerName, script);
    success('Pages deployed successfully!');

    const url = new URL(`https://${subdomain}/${path}/panel`);
    const payload = {
        url: url.href,
        user: account.email,
        key: await encrypt(account.token, env.SECRET)
    }

    complete(JSON.stringify(payload));
}

async function deployWorkers(
    env: Env,
    account: CFAccount,
    workerName: string,
    namespaceId: string,
    logger: StreamLogger,
    preRelease: boolean
) {
    const { success, complete } = logger;
    let subdomain: string;
    try {
        subdomain = await account.getWorkersDevSubdomain();
        success('Account workers subdomain is available!');
    } catch (error) {
        subdomain = await account.createWorkersDevSubdomain();
        success('Fresh account, Workers subdomain created successfully!');
    }

    const { buildScript } = await import('./script');
    const { script, path, kvBinding } = await buildScript(account, workerName, subdomain, 'worker.js', preRelease);
    success('Script built successfully!');

    await account.deployWorker(workerName, script, namespaceId, kvBinding);
    success('Worker deployed successfully!');

    await account.enableSubdomain(workerName);
    success('Worker subdomain enabled successfully!');

    const url = new URL(`https://${workerName}.${subdomain}/${path}/panel`);
    const payload = {
        url: url.href,
        user: account.email,
        key: await encrypt(account.token, env.SECRET)
    }

    complete(JSON.stringify(payload));
}
