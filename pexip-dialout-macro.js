/*!
 * MACRO: pexip-dialout v3.3.0
 *
 * v3.3.0 - Search + pagination for large directories (500+ entries)
 * v3.2.0 - Full <Name> tags for DX70/CE9
 * v3.0.0 - Standalone capable
 * v2.3.0 - Session ID for all API; protocol "auto"
 * v2.0.0 - Host check, role selection
 */

import xapi from 'xapi';

const MACRO = 'pexip-dialout';
const VERSION = 'v3.3.0';
const WIDGET = 'pex_do_';
const WID_CUSTOM = `${WIDGET}custom`;
const WID_SEARCH = `${WIDGET}search`;
const WID_CLEAR = `${WIDGET}clear`;
const WID_PREV = `${WIDGET}prev`;
const WID_NEXT = `${WIDGET}next`;
const PAGE_SIZE = 8; // entries per panel page (leaves room for nav row)

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
      if (!cfg.services?.length || !cfg.dialOut?.directory?.length) continue;
      SERVICES = cfg.services;
      DIALOUT = cfg.dialOut;
      DIALOUT.panelId = DIALOUT.panelId || 'pex_dialout_panel';
      DIALOUT.name = DIALOUT.name || 'Dial Out';
      DIALOUT.icon = DIALOUT.icon || 'Contacts';
      DIALOUT.directory.forEach(e => { if (!e.protocol) e.protocol = 'auto'; });
      // Sort directory alphabetically by name
      DIALOUT.directory.sort((a, b) => a.name.localeCompare(b.name));
      L.info('loadSettings', `Loaded from "${name}"`, { services: SERVICES.length, entries: DIALOUT.directory.length });
      return true;
    } catch { }
  }
  L.error('loadSettings', 'No valid settings macro found');
  return false;
}

// ---------------------------------------------------------------------------
//  HttpClient & Allow List
// ---------------------------------------------------------------------------
function extractHostname(url) {
  try { const m = url.match(/^https?:\/\/([^:/]+)/); return m ? m[1] : null; } catch { return null; }
}
async function enableHttpClient() {
  try { await xapi.Config.HttpClient.Mode.set('On'); } catch { }
}
async function ensureHostnameAllowed(hostname) {
  if (!hostname) return;
  try {
    const list = await xapi.Command.HttpClient.Allow.Hostname.List();
    const existing = list.HostName || [];
    if (existing.some(h => h.Expression === hostname)) return;
    if (existing.length >= 10) return;
    await xapi.Command.HttpClient.Allow.Hostname.Add({ Expression: hostname });
    L.info('ensureHostnameAllowed', `Added: ${hostname}`);
  } catch { }
}
async function ensureHttpAccess() {
  await enableHttpClient();
  const hostnames = new Set();
  for (const svc of SERVICES) { const h = extractHostname(svc.nodeURL); if (h) hostnames.add(h); }
  for (const h of hostnames) { await ensureHostnameAllowed(h); }
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
  searchState.query = null;
  searchState.page = 1;
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
//  UI
// ---------------------------------------------------------------------------
function notify(title, text, dur) {
  xapi.Command.UserInterface.Message.Alert.Display({ Title: title, Text: text, Duration: dur || 5 }).catch(() => { });
}
function esc(s) {
  const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  return String(s).replace(/[&<>"']/g, c => m[c]);
}
function promptRole(destination) {
  return new Promise(resolve => {
    const fbId = 'pex_do_role_' + Date.now();
    xapi.Command.UserInterface.Message.Prompt.Display({
      FeedbackId: fbId, Title: 'Select Role',
      Text: `Dial ${destination} as:`,
      'Option.1': 'Guest', 'Option.2': 'Host', 'Option.3': 'Cancel',
      Duration: 30,
    }).catch(() => resolve(null));
    const h1 = xapi.Event.UserInterface.Message.Prompt.Response.on(ev => {
      if (ev.FeedbackId !== fbId) return; h1();
      resolve(ev.OptionId === '1' ? 'GUEST' : ev.OptionId === '2' ? 'HOST' : null);
    });
    const h2 = xapi.Event.UserInterface.Message.Prompt.Cleared.on(ev => {
      if (ev.FeedbackId !== fbId) return; h2(); resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
//  Search & pagination state
// ---------------------------------------------------------------------------
const searchState = {
  query: null,
  page: 1,
};

function getFilteredDirectory() {
  if (!DIALOUT) return [];
  const dir = DIALOUT.directory;
  if (!searchState.query) return dir;
  const q = searchState.query.toLowerCase();
  return dir.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.address.toLowerCase().includes(q)
  );
}

function getPagedDirectory() {
  const filtered = getFilteredDirectory();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (searchState.page > totalPages) searchState.page = totalPages;
  if (searchState.page < 1) searchState.page = 1;
  const start = (searchState.page - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);
  return { entries: page, currentPage: searchState.page, totalPages, totalFiltered: filtered.length, startIndex: start };
}

// ---------------------------------------------------------------------------
//  Panel XML with search + pagination
// ---------------------------------------------------------------------------
function buildPanel() {
  const dc = DIALOUT;
  const title = esc(dc.name);
  const { entries, currentPage, totalPages, totalFiltered, startIndex } = getPagedDirectory();

  // Search row
  const searchLabel = searchState.query
    ? `Search: ${esc(searchState.query)} (${totalFiltered})`
    : `${dc.directory.length} contacts`;

  const searchRow = searchState.query
    ? `<Row><n>${searchLabel}</n><Widget><WidgetId>${WID_CLEAR}</WidgetId><n>Clear</n><Type>Button</Type><Options>size=1</Options></Widget></Row>`
    : `<Row><n>${searchLabel}</n><Widget><WidgetId>${WID_SEARCH}</WidgetId><n>Search</n><Type>Button</Type><Options>size=1</Options></Widget></Row>`;

  // Directory entry rows
  const rows = entries.map((e, i) => {
    const globalIdx = startIndex + i;
    const proto = e.protocol !== 'auto' ? ` [${e.protocol.toUpperCase()}]` : '';
    const label = esc(e.name + proto);
    return `<Row><n>${label}</n><Widget><WidgetId>${WIDGET}e${globalIdx}</WidgetId><Name/><Type>Button</Type><Options>size=1;icon=phone</Options></Widget></Row>`;
  }).join('\n');

  // Pagination row (only if more than one page)
  let navRow = '';
  if (totalPages > 1) {
    navRow = `<Row><n>Page ${currentPage} of ${totalPages}</n><Widget><WidgetId>${WID_PREV}</WidgetId><n>Prev</n><Type>Button</Type><Options>size=1</Options></Widget><Widget><WidgetId>${WID_NEXT}</WidgetId><n>Next</n><Type>Button</Type><Options>size=1</Options></Widget></Row>`;
  }

  // Custom dial row
  const customRow = `<Row><n>Custom Address</n><Widget><WidgetId>${WID_CUSTOM}</WidgetId><n>Dial</n><Type>Button</Type><Options>size=1</Options></Widget></Row>`;

  return `<Extensions>
<Version>1.7</Version>
<Panel>
  <PanelId>${dc.panelId}</PanelId>
  <Origin>local</Origin>
  <Type>InCall</Type>
  ${dc.color ? `<Color>${dc.color}</Color>` : ''}
  <n>${title}</n>
  <ActivityType>Custom</ActivityType>
  <Icon>${dc.icon}</Icon>
  <Page>
    <n>${title}</n>
    ${searchRow}
    ${rows}
    <Row><Name/></Row>
    ${navRow}
    ${customRow}
    <Options/>
  </Page>
</Panel>
</Extensions>`;
}

async function updatePanel() {
  const panelId = DIALOUT.panelId;
  const xml = buildPanel();
  try {
    await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: panelId }, xml);
  } catch (e) { L.error('updatePanel', e.message); }
}

async function deployPanel() {
  const panelId = DIALOUT.panelId;
  try { await xapi.Command.UserInterface.Extensions.Panel.Remove({ PanelId: panelId }); } catch { }
  searchState.query = null;
  searchState.page = 1;
  await updatePanel();
  L.info('deployPanel', 'OK', { entries: DIALOUT.directory.length });
}

// ---------------------------------------------------------------------------
//  Event handlers
// ---------------------------------------------------------------------------
async function onWidget(event) {
  if (event.Type !== 'clicked' || !event.WidgetId.startsWith(WIDGET)) return;
  const wid = event.WidgetId;

  // Search button
  if (wid === WID_SEARCH) {
    xapi.Command.UserInterface.Message.TextInput.Display({
      FeedbackId: 'pex_do_search', InputType: 'SingleLine',
      Title: 'Search Directory',
      Text: `Search ${DIALOUT.directory.length} contacts by name or address.`,
      Placeholder: 'Enter search term', SubmitText: 'Search',
    }).catch(() => { });
    return;
  }

  // Clear search
  if (wid === WID_CLEAR) {
    searchState.query = null;
    searchState.page = 1;
    await updatePanel();
    return;
  }

  // Pagination
  if (wid === WID_PREV) {
    if (searchState.page > 1) { searchState.page--; await updatePanel(); }
    return;
  }
  if (wid === WID_NEXT) {
    const { totalPages } = getPagedDirectory();
    if (searchState.page < totalPages) { searchState.page++; await updatePanel(); }
    return;
  }

  // Custom dial
  if (wid === WID_CUSTOM) {
    xapi.Command.UserInterface.Message.TextInput.Display({
      FeedbackId: 'pex_do_custom', InputType: 'SingleLine',
      Title: 'Dial Out — Custom Address',
      Text: 'Enter the SIP URI, H.323 address, or Teams address.',
      Placeholder: 'user@example.com', SubmitText: 'Next',
    }).catch(() => { });
    return;
  }

  // Directory entry
  if (wid.startsWith(`${WIDGET}e`)) {
    const idx = parseInt(wid.replace(`${WIDGET}e`, ''), 10);
    const entry = DIALOUT.directory[idx];
    if (!entry) return;
    if (!(await attach())) return;
    const role = await promptRole(entry.name);
    if (!role) return;
    await dialOut(entry.address, entry.protocol, role);
  }
}

async function onTextInput(event) {
  // Search response
  if (event.FeedbackId === 'pex_do_search') {
    const q = (event.Text || '').trim();
    if (!q) return;
    searchState.query = q;
    searchState.page = 1;
    L.info('onTextInput', `Search: "${q}"`, { results: getFilteredDirectory().length });
    await updatePanel();
    return;
  }

  // Custom dial response
  if (event.FeedbackId === 'pex_do_custom') {
    const addr = (event.Text || '').trim();
    if (!addr) { notify('Dial Out', 'No address entered.', 3); return; }
    let protocol = 'auto';
    if (/^rtmps?:\/\//i.test(addr)) protocol = 'rtmp';
    if (!(await attach())) return;
    const role = await promptRole(addr);
    if (!role) return;
    await dialOut(addr, protocol, role);
  }
}

async function onPanelClick(event) {
  if (!DIALOUT || event.PanelId !== DIALOUT.panelId) return;
  const ok = await attach();
  if (!ok) {
    notify('Dial Out Unavailable', 'Could not connect to the Pexip conference.', 5);
    xapi.Command.UserInterface.Extensions.Panel.Close();
    return;
  }
  if (conf.role !== 'HOST') {
    notify('Dial Out', `Connected as ${conf.role}. Only Hosts can dial out.`, 5);
  }
  // Refresh panel to show current page
  await updatePanel();
}

// ---------------------------------------------------------------------------
//  Init
// ---------------------------------------------------------------------------
async function init() {
  L.info('init', `Starting ${MACRO} ${VERSION}`);
  if (!(await loadSettings())) { L.error('init', 'Cannot start'); return; }
  await ensureHttpAccess();
  await deployPanel();
  xapi.Event.UserInterface.Extensions.Widget.Action.on(onWidget);
  xapi.Event.UserInterface.Extensions.Panel.Clicked.on(onPanelClick);
  xapi.Event.UserInterface.Message.TextInput.Response.on(onTextInput);
  xapi.Event.CallDisconnect.on(teardown);
  L.info('init', 'Ready');
}

init();