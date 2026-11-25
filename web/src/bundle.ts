import { createRuntimeProfile, encodeWorkerBundle, parseWorkerBundle, renameRuntimeSymbols, unpackSource } from '../../shared/worker-bundle.js';

// Keep the wire format and transformer in shared/ identical to Panel's implementation.
// Validate before adding credentials, and never include downloaded content in errors.
export async function prepareWorkerBundle(worker: string, config: unknown) {
    try {
        const previous = parseWorkerBundle(worker);
        const source = await unpackSource(previous.source);
        if (!source.trim() || worker.slice(worker.indexOf('\n') + 1) !== source) throw new Error();
        const compressedAssets = ['panel', 'login', 'error', 'proxy'] as const;
        await Promise.all(compressedAssets.map(async role => {
            const asset = await unpackSource(previous.assets[role]);
            if (!asset.trim()) throw new Error();
        }));
        if (!atob(previous.assets.icon).length) throw new Error();
        const profile = createRuntimeProfile();
        const script = renameRuntimeSymbols(source, previous.profile.names, profile.names);
        return { worker: await encodeWorkerBundle(script, previous.assets, profile, config), profile };
    } catch {
        throw new Error('Incompatible or corrupt panel worker bundle. Download a complete HESARI OS release with runtime profile format 1.');
    }
}
