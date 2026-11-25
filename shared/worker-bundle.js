// Shared by the Node.js installer and the Worker update path.
const roles = [
    'source', 'config', 'error', 'panel', 'login', 'proxy', 'icon',
    'protocolA', 'protocolALabel', 'protocolC', 'protocolCLabel',
    'protocolB', 'protocolBLabel', 'protocolD', 'client',
    'project', 'slug', 'repository', 'wizard', 'website', 'proxyHost', 'profile'
];
const assetRoles = ['panel', 'login', 'error', 'proxy', 'icon'];
const bootstrap = 'Object.assign(globalThis,';
const randomIdentifier = /^[a-z][a-f0-9]{24}$/;

function randomName() {
    const bytes = crypto.getRandomValues(new Uint8Array(13));
    return String.fromCharCode(97 + bytes[0] % 26)
        + Array.from(bytes.subarray(1), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createRuntimeProfile() {
    const names = Object.fromEntries(roles.map(role => [role, randomName()]));
    const profile = { format: 1, kvBinding: randomName(), names };
    validateRuntimeProfile(profile);
    return profile;
}

export function validateRuntimeProfile(profile) {
    if (!profile || profile.format !== 1 || !randomIdentifier.test(profile.kvBinding)
        || !profile.names || Object.keys(profile.names).length !== roles.length
        || roles.some(role => !randomIdentifier.test(profile.names[role]))
        || new Set([profile.kvBinding, ...Object.values(profile.names)]).size !== roles.length + 1) {
        throw new Error('Invalid runtime identifiers. Restore .local/identifiers.json from your installation backup.');
    }
}

// The compiler placeholders are assembled here so renaming free identifiers
// cannot accidentally rewrite the transformer's own lookup strings.
export const compilerNames = Object.fromEntries(roles.map(role => [role, ['', 'R', role.toUpperCase(), ''].join('_')]));

export function renameRuntimeSymbols(script, from, to) {
    const replacements = Object.fromEntries(roles.map(role => [from[role], to[role]]));
    const pattern = new RegExp(`\\b(?:${Object.keys(replacements).join('|')})\\b`, 'g');
    return script.replace(pattern, name => replacements[name]);
}

async function gzip(script) {
    const compressed = await new Response(new Blob([script]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const bytes = new Uint8Array(compressed);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    }
    return btoa(binary);
}

export async function unpackSource(encoded) {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

export function parseWorkerBundle(worker) {
    try {
        const firstLine = worker.slice(0, worker.indexOf('\n'));
        if (!firstLine.startsWith(bootstrap) || !firstLine.endsWith(');')) throw new Error();
        const values = JSON.parse(firstLine.slice(bootstrap.length, -2));
        const profile = Object.values(values).find(value => value?.format === 1 && value?.names);
        validateRuntimeProfile(profile);
        if (values[profile.names.profile] !== profile) throw new Error();
        const assets = Object.fromEntries(assetRoles.map(role => [role, values[profile.names[role]]]));
        const source = values[profile.names.source];
        if (typeof source !== 'string' || Object.values(assets).some(value => typeof value !== 'string')) throw new Error();
        return { profile, assets, source, config: values[profile.names.config] };
    } catch {
        throw new Error('The update source did not return a bundled panel worker. Rebuild the complete release.');
    }
}

export async function encodeWorkerBundle(script, assets, profile, config) {
    validateRuntimeProfile(profile);
    const values = Object.fromEntries(assetRoles.map(role => [profile.names[role], assets[role]]));
    values[profile.names.source] = await gzip(script);
    values[profile.names.profile] = profile;
    if (config !== undefined) values[profile.names.config] = config;
    return `${bootstrap}${JSON.stringify(values)});\n${script}`;
}

export async function personalizeWorkerBundle(worker, profile, config) {
    validateRuntimeProfile(profile);
    const previous = parseWorkerBundle(worker);
    const script = renameRuntimeSymbols(await unpackSource(previous.source), previous.profile.names, profile.names);
    return encodeWorkerBundle(script, previous.assets, profile, config);
}
