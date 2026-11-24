export const PANEL_REPOSITORY = 'mjhesari/Hesari-Os';
export const PANEL_WORKER_URL = `https://github.com/${PANEL_REPOSITORY}/releases/latest/download/worker.js`;

export async function panelWorkerURL(preRelease: boolean): Promise<string> {
    if (!preRelease) return PANEL_WORKER_URL;

    const response = await fetch(`https://api.github.com/repos/${PANEL_REPOSITORY}/releases`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'HESARI-OS-Wizard' }
    });
    if (!response.ok) throw new Error('Could not check HESARI OS releases. Please try again.');
    const releases = await response.json() as Array<{
        draft: boolean;
        assets: Array<{ name: string; browser_download_url: string }>;
    }>;
    const asset = releases.filter(release => !release.draft)
        .flatMap(release => release.assets.filter(asset => asset.name === 'worker.js'))[0];
    if (!asset) throw new Error('No installable HESARI OS release was found.');
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${PANEL_REPOSITORY}/releases/download/`)) {
        throw new Error('Unexpected HESARI OS release download URL.');
    }
    return url.href;
}
