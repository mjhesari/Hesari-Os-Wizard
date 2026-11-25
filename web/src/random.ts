export function randString(charset: string, minLen: number, maxLen: number) {
    const length = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    let string = '';

    for (let i = 0; i < length; i++) {
        string += charset[arr[i] % charset.length];
    }

    return string;
}

export function randSubdomain() {
    const charset = "abcdefghijklmnopqrstuvwxyz0123456789-";
    let subdomain: string;

    do {
        subdomain = randString(charset, 16, 32);
    } while (subdomain.startsWith('-') || subdomain.endsWith('-'));

    return subdomain;
}
