const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function importKey(secret: string): Promise<CryptoKey> {
    validateSecret(secret);
    const hash = await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(secret)
    );

    return crypto.subtle.importKey(
        'raw',
        hash,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
    );
}

export function validateSecret(secret: string): void {
    if (typeof secret !== 'string' || secret.length < 32) {
        throw new Error('Wizard is not configured. Set a random SECRET of at least 32 characters before installing.');
    }
}

export async function encrypt(text: string, secret: string): Promise<string> {
    const key = await importKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(text)
    );

    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);
    const base64Result = btoa(String.fromCharCode(...result));

    return base64Result;
}

export async function decrypt(encrypted: string, secret: string): Promise<string> {
    try {
        const key = await importKey(secret);
        const bytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
        const iv = bytes.slice(0, 12);
        const data = bytes.slice(12);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );

        return decoder.decode(decrypted);
    } catch (error) {
        throw new Error('This private link is invalid or has expired. Open the Wizard without the link and enter your Cloudflare token again.');
    }
}
