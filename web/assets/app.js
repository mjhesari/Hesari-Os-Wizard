const $ = id => document.getElementById(id);
const form = $('deployForm');
const tokenInput = $('apiToken');
const output = $('output');
const status = $('deploymentStatus');
const state = { privateKey: '', user: '', panelURL: '', busy: false };
let clipboardTimer;

const permissions = [
    { key: 'workers_scripts', type: 'edit' },
    { key: 'workers_kv_storage', type: 'edit' },
    { key: 'page', type: 'edit' },
    { key: 'dns', type: 'edit' },
    { key: 'user_details', type: 'read' }
];
const template = new URL('https://dash.cloudflare.com/profile/api-tokens');
template.searchParams.set('permissionGroupKeys', JSON.stringify(permissions));
template.searchParams.set('accountId', '*');
template.searchParams.set('zoneId', 'all');
template.searchParams.set('name', 'HESARI-OS-Wizard');
$('tokenTemplate').href = template.href;

function connectAccount(key, user) {
    state.privateKey = key;
    state.user = user;
    tokenInput.value = '';
    tokenInput.required = !key;
    $('apiTokenGroup').hidden = Boolean(key);
    $('steps').hidden = Boolean(key);
    $('accountBanner').hidden = !key;
    $('user').textContent = user;
}

const initialURL = new URL(location.href);
const fragment = new URLSearchParams(initialURL.hash.slice(1));
const initialKey = fragment.get('key') || initialURL.searchParams.get('key');
if (initialKey) {
    connectAccount(initialKey, fragment.get('user') || initialURL.searchParams.get('user') || 'Saved Cloudflare account');
    initialURL.searchParams.delete('key');
    initialURL.searchParams.delete('user');
    if (fragment.has('key')) initialURL.hash = '';
    history.replaceState(null, '', initialURL.pathname + initialURL.search + initialURL.hash);
}

$('changeAccount').addEventListener('click', () => {
    if (state.busy) return;
    connectAccount('', '');
    $('privateLinkCard').hidden = true;
    tokenInput.focus();
});
$('togglePassword').addEventListener('click', () => {
    const show = tokenInput.type === 'password';
    tokenInput.type = show ? 'text' : 'password';
    $('togglePassword').setAttribute('aria-pressed', String(show));
    $('togglePassword').setAttribute('aria-label', show ? 'Hide token' : 'Show token');
});

function setStatus(value, text) {
    status.dataset.state = value;
    status.textContent = text;
}
function setBusy(busy) {
    state.busy = busy;
    form.setAttribute('aria-busy', String(busy));
    form.querySelectorAll('button, input').forEach(element => { element.disabled = busy; });
    $('changeAccount').disabled = busy;
    $('installLabel').textContent = busy ? 'Installing your workspace…' : 'Install HESARI OS';
}
function log(type, message) {
    const row = document.createElement('div');
    row.className = `log-entry terminal-${type}`;
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = { info: '›', success: '✓', error: '×' }[type] || '›';
    const text = document.createElement('span');
    text.textContent = message;
    row.append(mark, text);
    output.appendChild(row);
    output.scrollTop = output.scrollHeight;
}
function validatePanelURL(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['.workers.dev', '.pages.dev'].some(suffix => url.hostname.endsWith(suffix))) {
        throw new Error('The installer returned an invalid panel link.');
    }
    return url.href;
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;
    const payload = new FormData(form);
    if (state.privateKey) payload.set('privateKey', state.privateKey);
    setBusy(true);
    setStatus('running', 'Installing');
    $('formError').hidden = true;
    $('deploymentResult').hidden = true;
    $('privateLinkCard').hidden = true;
    state.panelURL = '';
    output.replaceChildren();
    log('info', 'Connecting to your Cloudflare account…');
    let completed = false;
    let serverError = '';
    const handleLine = line => {
        if (!line.trim()) return;
        const { type, message } = JSON.parse(line);
        if (type === 'complete') {
            if (serverError) return;
            const result = JSON.parse(message);
            state.panelURL = validatePanelURL(result.url);
            connectAccount(result.key, result.user);
            $('liveUrl').href = state.panelURL;
            $('deploymentResult').hidden = false;
            $('privateLinkCard').hidden = false;
            completed = true;
            setStatus('success', 'Installed');
            log('success', 'HESARI OS is installed. Your workspace is ready.');
        } else if (['success', 'info', 'error'].includes(type)) {
            log(type, message);
            if (type === 'error') serverError = message;
        }
    };
    try {
        const endpoint = new URL('/api/deploy', location.origin);
        if (new URLSearchParams(location.search).get('pre-release') === 'true') endpoint.searchParams.set('pre-release', 'true');
        const response = await fetch(endpoint, { method: 'POST', body: payload });
        if (!response.ok) throw new Error(`The installer could not connect (HTTP ${response.status}). Please try again.`);
        if (!response.body) throw new Error('No deployment response was received. Please try again.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(handleLine);
        }
        buffer += decoder.decode();
        handleLine(buffer);
        if (serverError) throw new Error(serverError);
        if (!completed) throw new Error('The connection ended before installation finished. Check your Cloudflare dashboard before trying again.');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Installation failed. Please try again.';
        if (!serverError) log('error', message);
        $('formError').textContent = message;
        $('formError').hidden = false;
        setStatus('error', 'Failed');
    } finally {
        setBusy(false);
    }
});

form.querySelectorAll('input[name="deployType"]').forEach(input => input.addEventListener('change', () => {
    $('destinationLabel').textContent = `DESTINATION / ${input.value.toUpperCase()}`;
}));

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        $('clipboardStatus').textContent = 'Copied to clipboard.';
    } catch {
        $('clipboardStatus').textContent = 'Clipboard access is unavailable. Allow clipboard access in your browser and try again.';
    }
    $('clipboardStatus').hidden = false;
    clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(() => { $('clipboardStatus').hidden = true; }, 4000);
}
$('copyPanelURL').addEventListener('click', () => copyText(state.panelURL));
$('copyURL').addEventListener('click', () => {
    const url = new URL(location.pathname, location.origin);
    if (new URLSearchParams(location.search).get('pre-release') === 'true') url.searchParams.set('pre-release', 'true');
    url.hash = new URLSearchParams({ key: state.privateKey, user: state.user }).toString();
    copyText(url.href);
});
document.querySelectorAll('.copy-command').forEach(button => button.addEventListener('click', () => copyText($(button.dataset.command).textContent)));

const tabs = [$('unixTab'), $('windowsTab')];
function selectTab(tab) {
    for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        $(item.getAttribute('aria-controls')).hidden = !selected;
    }
}
for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[1 - tabs.indexOf(tab)];
        selectTab(next);
        next.focus();
    });
}
document.querySelectorAll('.sidebar-nav a[href^="#"]').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-nav a').forEach(item => item.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'location');
}));
