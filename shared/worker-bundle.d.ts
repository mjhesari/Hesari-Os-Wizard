export type RuntimeRole = 'source' | 'config' | 'error' | 'panel' | 'login' | 'proxy' | 'icon'
    | 'protocolA' | 'protocolALabel' | 'protocolC' | 'protocolCLabel' | 'protocolB' | 'protocolBLabel'
    | 'protocolD' | 'client' | 'project' | 'slug' | 'repository' | 'wizard' | 'website' | 'proxyHost' | 'profile';
export interface RuntimeProfile {
    format: 1;
    kvBinding: string;
    names: Record<RuntimeRole, string>;
}
export type WorkerAssets = Record<'panel' | 'login' | 'error' | 'proxy' | 'icon', string>;
export function createRuntimeProfile(): RuntimeProfile;
export function validateRuntimeProfile(profile: unknown): asserts profile is RuntimeProfile;
export const compilerNames: RuntimeProfile['names'];
export function renameRuntimeSymbols(script: string, from: RuntimeProfile['names'], to: RuntimeProfile['names']): string;
export function unpackSource(encoded: string): Promise<string>;
export function parseWorkerBundle(worker: string): { profile: RuntimeProfile; assets: WorkerAssets; source: string; config?: unknown };
export function encodeWorkerBundle(script: string, assets: WorkerAssets, profile: RuntimeProfile, config?: unknown): Promise<string>;
export function personalizeWorkerBundle(worker: string, profile: RuntimeProfile, config?: unknown): Promise<string>;
