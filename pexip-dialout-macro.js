/*!
 * MACRO: pexip-dialout v4.2.0-feature/remote-directory
 *
 * Feature branch: Remote directory support.
 * Fetches the contact directory from a URL on startup and when the panel
 * is opened. Falls back to the static directory in settings if fetch fails.
 *
 * SETTINGS: Add a "directoryUrl" to the dialOut section:
 *
 *   "dialOut": {
 *     "directoryUrl": "https://intranet.example.com/pexip/directory.json",
 *     "refreshInterval": 300,
 *     "directory": [ ... fallback contacts ... ]
 *   }
 *
 * The URL should return a JSON array:
 *   [
 *     { "name": "Room Alpha", "address": "alpha@example.com" },
 *     { "name": "H.323 Room", "address": "10.0.1.50", "protocol": "h323" }
 *   ]
 *
 * v4.2.0 - Remote directory fetch with fallback to static settings
 * v4.1.0 - <n> tag for DX70; prompt-based UI
 * v3.0.0 - Standalone capable
 * v2.0.0 - Host check, role selection
 */

import xapi from 'xapi';

const MACRO = 'pexip-dialout';
const VERSION = 'v4.2.0-remote-directory';

const L = {
  info: (m, msg, e) => console.info(`${VERSION} INFO  [${m}] ${msg}`, e ? JSON.stringify(e) : ''),
  warn: (m, msg, e) => console.warn(`${VERSION} WARN  [${m}] ${msg}`, e ? JSON.stringify(e) : ''),
  error: (m, msg, e) => console.error(`${VERSION} ERROR [${m}] ${msg}`, e ? JSON.stringify(e) : ''),
};

// ---------------------------------------------------------------------------
//  Settings
// ---------------------------------------------------------------------------
let SERVICES = [];
let DIALOUT = null;

async function loadSettings() {
  for (const name of ['meeting-controls-settings', 'meeting-controls-settings (1)', 'call-macro-settings']) {
    try {
      const m = await xapi.Command.Macros.Macro.Get({ Content: true, Name: name });
      const raw = m.Macro[0].Content;
      const cfg = JSON.parse(raw.substring(raw.indexOf('{')).replace(/;\s*$/, ''));
      if (!cfg.services?.length || !cfg.dialOut) continue;
      SERVICES = cfg.services;
      DIALOUT = cfg.dialOut;
      DIALOUT.panelId = DIALOUT.panelId || 'pex_dialout_panel';
      DIALOUT.name = DIALOUT.name || 'Dial Out';
      DIALOUT.icon = DIALOUT.icon || 'Contacts';
      DIALOUT.directory = DIALOUT.directory || [];
      DIALOUT.directory.forEach(e => { if (!e.protocol) e.protocol = 'auto'; });
      DIALOUT.refreshInterval = DIALOUT.refreshInterval || 0; // seconds, 0 = fetch on each panel open
      L.info('loadSettings', `Loaded from "${name}"`, {
        services: SERVICES.length,
        staticEntries: DIALOUT.directory.length,
        directoryUrl: DIALOUT.directoryUrl || 'none',
        refreshInterval: DIALOUT.refreshInterval,
      });
      return true;
    } catch { }
  }
  L.error('loadSettings', 'No valid settings macro found');
  return false;
}

// ---------------------------------------------------------------------------
//  Remote directory fetch
// ---------------------------------------------------------------------------
let remoteDirectory = null;      // fetched entries (null = never fetched)
let lastFetchTime = 0;           // epoch ms of last successful fetch
let fetchInProgress = false;

async function httpGet(url) {
  try {
    const r = await xapi.Command.HttpClient.Get(
      { Url: url, ResultBody: 'PlainText', Timeout: 10, AllowInsecureHTTPS: false });
    return { ok: true, body: r.Body };
  } catch (e) {
    return { ok: false, status: e?.data?.StatusCode || '', msg: e?.message || 'unknown' };
  }
}

/**
 * Fetch directory from the configured URL.
 * Returns the parsed array or null on failure.
 *
 * Expected JSON format:
 *   [
 *     { "name": "Room Alpha", "address": "alpha@example.com" },
 *     { "name": "H.323 Room", "address": "10.0.1.50", "protocol": "h323" }
 *   ]
 *
 * Also supports a wrapper object:
 *   { "directory": [ ... ] }
 */
async function fetchRemoteDirectory() {
  const url = DIALOUT.directoryUrl;
  if (!url) return null;

  if (fetchInProgress) {
    L.info('fetchRemoteDirectory', 'Fetch already in progress, skipping');
    return remoteDirectory;
  }

  // Check if refresh interval hasn't elapsed
  if (DIALOUT.refreshInterval > 0 && remoteDirectory && lastFetchTime > 0) {
    const elapsed = (Date.now() - lastFetchTime) / 1000;
    if (elapsed < DIALOUT.refreshInterval) {
      L.info('fetchRemoteDirectory', `Using cached (${Math.round(elapsed)}s of ${DIALOUT.refreshInterval}s)`);
      return remoteDirectory;
    }
  }

  fetchInProgress = true;
  L.info('fetchRemoteDirectory', `GET ${url}`);

  const r = await httpGet(url);
  fetchInProgress = false;

  if (!r.ok) {
    L.warn('fetchRemoteDirectory', `Fetch failed: HTTP ${r.status}`, { msg: r.msg });
    return null;
  }

  try {
    let entries = JSON.parse(r.body);

    // Support wrapper object: { "directory": [...] }
    if (entries && !Array.isArray(entries) && Array.isArray(entries.directory)) {
      entries = entries.directory;
    }

    if (!Array.isArray(entries)) {
      L.warn('fetchRemoteDirectory', 'Response is not an array');
      return null;
    }

    // Validate and apply defaults
    const valid = entries.filter(e => e.name && e.address).map(e => ({
      name: String(e.name),
      address: String(e.address),
      protocol: String(e.protocol || 'auto'),
    }));

    valid.sort((a, b) => a.name.localeCompare(b.name));

    remoteDirectory = valid;
    lastFetchTime = Date.now();

    L.info('fetchRemoteDirectory', `Fetched ${valid.length} entries`, {
      first: valid.length > 0 ? valid[0].name : 'none',
    });

    return valid;
  } catch (e) {
    L.warn('fetchRemoteDirectory', `Parse error: ${e.message}`);
    return null;
  }
}

/**
 * Get the current directory — remote if available, otherwise static fallback.
 * Triggers a fetch if needed.
 */
async function getDirectory() {
  if (DIALOUT.directoryUrl) {
    const remote = await fetchRemoteDirectory();
    if (remote && remote.length > 0) return remote;
    L.info('getDirectory', 'Remote unavailable, using static fallback');
  }
  return DIALOUT.directory;
}

// ---------------------------------------------------------------------------
//  HttpClient & Allow List
// ---------------------------------------------------------------------------
function extractHostname(url) {
  try { const m = url.match(/^https?:\/\/([^:/]+)/); return m ? m[1] : null; } catch { return null; }
}
async function ensureHttpAccess() {
  try { await xapi.Config.HttpClient.Mode.set('On'); } catch { }
  const hostnames = new Set();
  // Add Pexip node hostnames
  for (const svc of SERVICES) { const h = extractHostname(svc.nodeURL); if (h) hostnames.add(h); }
  // Add directory URL hostname
  if (DIALOUT.directoryUrl) {
    const h = extractHostname(DIALOUT.directoryUrl);
    if (h) hostnames.add(h);
  }
  for (const hostname of hostnames) {
    try {
      const list = await xapi.Command.HttpClient.Allow.Hostname.List();
      const existing = list.HostName || [];
      if (!existing.some(h => h.Expression === hostname) && existing.length < 10) {
        await xapi.Command.HttpClient.Allow.Hostname.Add({ Expression: hostname });
        L.info('ensureHttpAccess', `Added to allow list: ${hostname}`);
      }
    } catch { }
  }
}

// ---------------------------------------------------------------------------
//  Service matching / alias
// ---------------------------------------------------------------------------
function matchService(alias) {
  for (const svc of SERVICES) {
    let re = svc.regex.replace('{{teamsMeetingId}}', '\\d{9,12}');
    if (!re.startsWith('^')) re = '^' + re;
    if (!re.endsWith('$')) re = re + '$';
    try { if (new RegExp(re).test(alias)) return svc; } catch { }
  }
  return null;
}
function cleanAlias(raw) { return raw.replace(/\*\*\d+@/, '@'); }

// ---------------------------------------------------------------------------
//  Conference state
// ---------------------------------------------------------------------------
let conf = freshState();
function freshState() {
  return { active: false, alias: null, sessionId: null, nodeURL: null, token: null, role: null, timer: null };
}
function teardown() {
  if (conf.timer) clearInterval(conf.timer);
  if (conf.token) post(apiUrl('release_token'), hdrs(), '').catch(() => { });
  conf = freshState();
  L.info('teardown', 'Disconnected');
}
function apiUrl(ep) { return `${conf.nodeURL}/${conf.sessionId}/${ep}`; }

// ---------------------------------------------------------------------------
//  HTTP
// ---------------------------------------------------------------------------
function hdrs() {
  const h = ['Content-Type: application/json'];
  if (conf.token) h.push(`Token: ${conf.token}`);
  if (conf.alias) h.push(`Conference-Alias: ${conf.alias}`);
  return h;
}
async function post(url, headers, body) {
  try {
    const r = await xapi.Command.HttpClient.Post(
      { Url: url, Header: headers, ResultBody: 'PlainText', Timeout: 15, AllowInsecureHTTPS: false }, body);
    return { ok: true, body: r.Body };
  } catch (e) { return { ok: false, status: e?.data?.StatusCode || '', msg: e?.message || 'unknown' }; }
}

// ---------------------------------------------------------------------------
//  Token
// ---------------------------------------------------------------------------
async function getDisplayName() {
  for (const fn of [
    () => xapi.Config.SIP.DisplayName.get(),
    () => xapi.Status.UserInterface.ContactInfo.Name.get(),
    () => xapi.Config.SystemUnit.Name.get(),
  ]) { try { const v = await fn(); if (v) return v; } catch { } }
  return 'Cisco Endpoint';
}
async function acquireToken() {
  const name = await getDisplayName();
  const url = apiUrl('request_token');
  const headers = ['Content-Type: application/json'];
  if (conf.alias) headers.push(`Conference-Alias: ${conf.alias}`);
  const r = await post(url, headers, JSON.stringify({ display_name: name, client_id: `${MACRO}/${VERSION}` }));
  if (!r.ok) { L.error('acquireToken', `HTTP ${r.status}`); return false; }
  try {
    const p = JSON.parse(r.body);
    if (p.status !== 'success') return false;
    conf.token = p.result.token;
    conf.role = p.result.role;
    conf.timer = setInterval(refreshToken, 60000);
    L.info('acquireToken', 'Token acquired', { role: conf.role });
    return true;
  } catch { return false; }
}
async function refreshToken() {
  const r = await post(apiUrl('refresh_token'), hdrs(), '');
  if (r.ok) { try { const p = JSON.parse(r.body); if (p.result?.token) conf.token = p.result.token; } catch { } }
}

// ---------------------------------------------------------------------------
//  Session ID
// ---------------------------------------------------------------------------
async function getSessionId(callId) {
  try {
    const raw = await xapi.Status.Conference.Call[callId].Sip.SessionId.get();
    if (!raw) return null;
    const p = raw.split(';').find(s => s.includes('remote='));
    return p ? p.replace('remote=', '').trim() : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
//  Attach
// ---------------------------------------------------------------------------
async function attach() {
  if (conf.active && conf.token) return true;
  let calls;
  try { calls = await xapi.Status.Call.get(); } catch { return false; }
  const call = calls?.find(c => c.Status === 'Connected');
  if (!call) return false;
  const rawAlias = call.RemoteNumber;
  const svc = matchService(rawAlias);
  if (!svc) return false;
  const sid = await getSessionId(call.id);
  if (!sid) return false;
  conf.alias = cleanAlias(rawAlias);
  conf.sessionId = sid;
  conf.nodeURL = svc.nodeURL;
  conf.active = true;
  if (!(await acquireToken())) { conf = freshState(); return false; }
  return true;
}

// ---------------------------------------------------------------------------
//  Dial out
// ---------------------------------------------------------------------------
async function dialOut(destination, protocol, role) {
  if (!conf.active || !conf.token) { notify('Dial Out Failed', 'Not connected.'); return; }
  if (conf.role !== 'HOST') { notify('Dial Out Denied', 'Only Hosts can dial out.'); return; }
  protocol = protocol || 'auto';
  role = (role || 'GUEST').toUpperCase();
  const url = apiUrl('dial');
  const body = JSON.stringify({ destination, protocol, role });
  L.info('dialOut', `Dialling ${destination}`, { protocol, role });
  notify('Dialling...', `Calling ${destination}`, 3);
  const r = await post(url, hdrs(), body);
  if (!r.ok) {
    L.error('dialOut', `Failed: ${destination}`, { status: r.status });
    notify('Dial Out Failed', `Error ${r.status}: could not dial ${destination}`);
    return;
  }
  try {
    const p = JSON.parse(r.body);
    if (p.status === 'success') {
      L.info('dialOut', `Success: ${destination}`, { result: p.result });
      notify('Dial Out Successful', `${destination} has been invited.`);
    } else { notify('Dial Out Issue', `Unexpected response for ${destination}`); }
  } catch { notify('Dial Out Sent', `Request sent to ${destination}`); }
}

// ---------------------------------------------------------------------------
//  UI helpers
// ---------------------------------------------------------------------------
function notify(title, text, dur) {
  xapi.Command.UserInterface.Message.Alert.Display({ Title: title, Text: text, Duration: dur || 5 }).catch(() => { });
}
function esc(s) {
  const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return String(s).replace(/[&<>"']/g, c => m[c]);
}
function showPrompt(title, text, options) {
  return new Promise(resolve => {
    const fbId = 'pex_do_' + Date.now();
    const params = { FeedbackId: fbId, Title: title, Text: text, Duration: 60 };
    options.forEach((opt, i) => { params[`Option.${i + 1}`] = opt; });
    xapi.Command.UserInterface.Message.Prompt.Display(params).catch(() => resolve(null));
    const h1 = xapi.Event.UserInterface.Message.Prompt.Response.on(ev => {
      if (ev.FeedbackId !== fbId) return; h1(); h2();
      resolve(parseInt(ev.OptionId, 10));
    });
    const h2 = xapi.Event.UserInterface.Message.Prompt.Cleared.on(ev => {
      if (ev.FeedbackId !== fbId) return; h1(); h2();
      resolve(null);
    });
  });
}
function showTextInput(title, text, placeholder, submitText) {
  return new Promise(resolve => {
    const fbId = 'pex_do_ti_' + Date.now();
    xapi.Command.UserInterface.Message.TextInput.Display({
      FeedbackId: fbId, InputType: 'SingleLine',
      Title: title, Text: text,
      Placeholder: placeholder, SubmitText: submitText || 'OK',
    }).catch(() => resolve(null));
    const h1 = xapi.Event.UserInterface.Message.TextInput.Response.on(ev => {
      if (ev.FeedbackId !== fbId) return; h1(); h2();
      resolve(ev.Text || null);
    });
    const h2 = xapi.Event.UserInterface.Message.TextInput.Clear.on(ev => {
      if (ev.FeedbackId !== fbId) return; h1(); h2();
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
//  Prompt-based directory browser
// ---------------------------------------------------------------------------
async function showMainMenu() {
  // Fetch/refresh directory each time the menu opens
  const directory = await getDirectory();
  const total = directory.length;

  if (total === 0) {
    notify('Dial Out', 'No contacts available.', 5);
    return;
  }

  const source = (DIALOUT.directoryUrl && remoteDirectory) ? '(remote)' : '(local)';
  const choice = await showPrompt(
    'Dial Out',
    `${total} contacts ${source}. Choose an option:`,
    ['Browse Directory', 'Search by Name', 'Dial Custom Address']
  );
  if (choice === 1) await browseDirectory(directory, 0);
  else if (choice === 2) await searchDirectory(directory);
  else if (choice === 3) await customDial();
}

async function browseDirectory(entries, offset) {
  if (entries.length === 0) { notify('No Results', 'No contacts found.', 3); return; }
  const ITEMS = 3;
  const totalPages = Math.ceil(entries.length / ITEMS);
  const currentPage = Math.floor(offset / ITEMS) + 1;
  const pageEntries = entries.slice(offset, offset + ITEMS);
  const isFirst = offset === 0;
  const isLast = offset + ITEMS >= entries.length;
  const options = pageEntries.map(e => e.name);
  if (!isFirst && !isLast) { options.push('← Previous'); options.push('Next →'); }
  else if (!isFirst) { options.push('← Back'); }
  else if (!isLast) { options.push('Next →'); }
  const title = `Directory (${currentPage}/${totalPages})`;
  const choice = await showPrompt(title,
    `Showing ${offset + 1}-${Math.min(offset + ITEMS, entries.length)} of ${entries.length}`,
    options);
  if (!choice) return;
  const count = pageEntries.length;
  if (choice <= count) {
    await selectContact(pageEntries[choice - 1], entries, offset);
  } else {
    const nav = options[choice - 1];
    if (nav.includes('Previous') || nav.includes('Back')) await browseDirectory(entries, Math.max(0, offset - ITEMS));
    else if (nav.includes('Next')) await browseDirectory(entries, offset + ITEMS);
  }
}

async function searchDirectory(directory) {
  const query = await showTextInput('Search Directory',
    `Search ${directory.length} contacts by name or address.`,
    'Enter search term', 'Search');
  if (!query) return;
  const q = query.toLowerCase();
  const results = directory.filter(e =>
    e.name.toLowerCase().includes(q) || e.address.toLowerCase().includes(q));
  L.info('searchDirectory', `"${query}" → ${results.length} results`);
  if (results.length === 0) {
    const retry = await showPrompt('No Results', `No contacts matching "${query}".`,
      ['Search Again', 'Browse All', 'Cancel']);
    if (retry === 1) await searchDirectory(directory);
    else if (retry === 2) await browseDirectory(directory, 0);
    return;
  }
  await browseDirectory(results, 0);
}

async function selectContact(entry, parentList, parentOffset) {
  const role = await showPrompt(`Dial: ${entry.name}`, `Address: ${entry.address}`,
    ['Dial as Guest', 'Dial as Host', 'Back', 'Cancel']);
  if (role === 1) { if (await attach()) await dialOut(entry.address, entry.protocol, 'GUEST'); }
  else if (role === 2) { if (await attach()) await dialOut(entry.address, entry.protocol, 'HOST'); }
  else if (role === 3) { await browseDirectory(parentList, parentOffset); }
}

async function customDial() {
  const addr = await showTextInput('Dial Custom Address',
    'Enter the SIP URI, H.323 address, or Teams address.',
    'user@example.com', 'Next');
  if (!addr || !addr.trim()) return;
  const address = addr.trim();
  let protocol = 'auto';
  if (/^rtmps?:\/\//i.test(address)) protocol = 'rtmp';
  const role = await showPrompt('Dial Custom', `Address: ${address}`,
    ['Dial as Guest', 'Dial as Host', 'Cancel']);
  if (role === 1 || role === 2) {
    if (await attach()) await dialOut(address, protocol, role === 1 ? 'GUEST' : 'HOST');
  }
}

// ---------------------------------------------------------------------------
//  Panel
// ---------------------------------------------------------------------------
function buildPanel() {
  const dc = DIALOUT;
  return '<Extensions>\n'
    + '  <Version>1.7</Version>\n'
    + '  <Panel>\n'
    + '    <PanelId>' + dc.panelId + '</PanelId>\n'
    + '    <Origin>local</Origin>\n'
    + '    <Type>InCall</Type>\n'
    + '    <Icon>' + dc.icon + '</Icon>\n'
    + (dc.color ? '    <Color>' + dc.color + '</Color>\n' : '')
    + '    <Name>' + esc(dc.name) + '</Name>\n'
    + '    <ActivityType>Custom</ActivityType>\n'
    + '  </Panel>\n'
    + '</Extensions>';
}

async function deployPanel() {
  const panelId = DIALOUT.panelId;
  try { await xapi.Command.UserInterface.Extensions.Panel.Remove({ PanelId: panelId }); } catch { }
  const xml = buildPanel();
  try {
    await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: panelId }, xml);
    L.info('deployPanel', 'OK');
  } catch (e) { L.error('deployPanel', e.message); }
}

// ---------------------------------------------------------------------------
//  Event handlers
// ---------------------------------------------------------------------------
async function onPanelClick(event) {
  if (!DIALOUT || event.PanelId !== DIALOUT.panelId) return;
  xapi.Command.UserInterface.Extensions.Panel.Close().catch(() => { });
  const ok = await attach();
  if (!ok) { notify('Dial Out Unavailable', 'Could not connect to the Pexip conference.', 5); return; }
  if (conf.role !== 'HOST') { notify('Dial Out', `Connected as ${conf.role}. Only Hosts can dial out.`, 5); return; }
  await showMainMenu();
}

// ---------------------------------------------------------------------------
//  Init
// ---------------------------------------------------------------------------
async function init() {
  L.info('init', `Starting ${MACRO} ${VERSION}`);
  if (!(await loadSettings())) { L.error('init', 'Cannot start'); return; }
  await ensureHttpAccess();

  // Initial directory fetch (non-blocking — falls back to static)
  if (DIALOUT.directoryUrl) {
    fetchRemoteDirectory().then(entries => {
      if (entries) L.info('init', `Remote directory pre-fetched: ${entries.length} entries`);
      else L.info('init', 'Remote directory unavailable, will use static fallback');
    });
  }

  await deployPanel();
  xapi.Event.UserInterface.Extensions.Panel.Clicked.on(onPanelClick);
  xapi.Event.CallDisconnect.on(teardown);
  L.info('init', 'Ready');
}

init();