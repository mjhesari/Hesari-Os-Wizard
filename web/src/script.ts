import { toFile, Uploadable } from "cloudflare";
import { CFAccount } from "./api";
import { randString } from "./random";
import { panelWorkerURL } from './config';
import { prepareWorkerBundle } from './bundle';

interface Script {
    script: Uploadable;
    path: string;
    kvBinding: string;
}

export async function buildScript(
    account: CFAccount,
    workerName: string,
    subdomain: string,
    filename: string,
    preRelease: boolean
): Promise<Script> {
    const pathCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456780-_';
    const passCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&*_-+;:,.';

    const url = await panelWorkerURL(preRelease);

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Could not download HESARI OS (HTTP ${res.status}).`)
    }

    const script = await res.text();
    const path = randString(pathCharset, 12, 16);

    const embededSettings = {
        accID: account.id,
        accEmail: account.email,
        apiToken: account.token,
        vlUUID: crypto.randomUUID(),
        trPass: randString(passCharset, 16, 20),
        securePath: path,
        proxyIpMode: 'proxyip',
        proxyIPs: [],
        prefixes: [],
        fallback: '',
        dohUrl: '',
        mainDomain: `${workerName}.${subdomain}`
    };

    const { worker, profile } = await prepareWorkerBundle(script, embededSettings);

    const file = new TextEncoder().encode(worker);
    const uploadable: Uploadable = await toFile(file, filename, {
        type: 'application/javascript+module',
    });

    return {
        script: uploadable,
        path: path,
        kvBinding: profile.kvBinding
    }
}
