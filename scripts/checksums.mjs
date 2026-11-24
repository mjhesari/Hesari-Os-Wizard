import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.argv[2] || 'dist';
const files = (await readdir(directory)).filter(name => /^HESARI-Wizard-.*\.(zip|tar\.gz)$/.test(name)).sort();
if (!files.length) throw new Error('No HESARI OS Wizard archives found. Build or download the release archives first.');
const lines = [];
for (const name of files) {
    const hash = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
    lines.push(`${hash}  ${name}`);
}
await writeFile(join(directory, 'SHA256SUMS'), lines.join('\n') + '\n');
console.log(`Wrote SHA256SUMS for ${files.length} archives.`);
