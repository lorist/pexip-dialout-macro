/*!
 * MACRO: pexip-dialout v3.1.0
 *
 * Dial out participants from a Pexip Infinity VMR via the in-call panel
 * on Cisco CE/RoomOS endpoints. Standalone or alongside call-macro.
 *
 * v3.1.0 - Always Version 1.7 in XML; match call-macro whitespace/structure
 * v3.0.1 - Fix XML element order
 * v3.0.0 - Standalone capable
 */

import xapi from 'xapi';

const MACRO = 'pexip-dialout';
const VERSION = 'v3.1.0';
const WIDGET = 'pex_do_';
const WID_CUSTOM = `${WIDGET}custom`;

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
  try { await xapi.Config.HttpClient.Mode.set('On'); L.info('enableHttpClient', 'OK'); }
  catch (e) { L.error('enableHttpClient', e.message); }
}
async function ensureHostnameAllowed(hostname) {
  if (!hostname) return;
  try {
    const list = await xapi.Command.HttpClient.Allow.Hostname.List();
    const existing = list.HostName || [];
    if (existing.some(h => h.Expression === hostname)) return;
    if (existing.length >= 10) { L.warn('ensureHostnameAllowed', 'Allow list full'); return; }
    await xapi.Command.HttpClient.Allow.Hostname.Add({ Expression: hostname });
    L.info('ensureHostnameAllowed', `Added: ${hostname}`);
  } catch (e) { L.warn('ensureHostnameAllowed', e.message); }
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
  L.info('acquireToken', `POST ${url}`);
  const r = await post(url, headers, JSON.stringify({ display_name: name, client_id: `${MACRO}/${VERSION}` }));
  if (!r.ok) { L.error('acquireToken', `HTTP ${r.status}`); return false; }
  try {
    const p = JSON.parse(r.body);
    if (p.status !== 'success') { L.error('acquireToken', 'Non-success'); return false; }
    conf.token = p.result.token;
    conf.role = p.result.role;
    conf.timer = setInterval(refreshToken, 60000);
    L.info('acquireToken', 'Token acquired', { role: conf.role, display_name: p.result.display_name });
    return true;
  } catch (e) { L.error('acquireToken', e.message); return false; }
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
  if (!sid) { L.error('attach', 'No session ID'); return false; }
  conf.alias = cleanAlias(rawAlias);
  conf.sessionId = sid;
  conf.nodeURL = svc.nodeURL;
  conf.active = true;
  L.info('attach', 'Connecting', { alias: conf.alias, sessionId: sid });
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
  L.info('dialOut', `Dialling ${destination}`, { protocol, role, url });
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
//  Panel XML — mirrors call-macro's exact structure and element order
//  ALWAYS uses Version 1.7 (call-macro does this too)
//  Element order: PanelId → Origin → Type → Color → Name → ActivityType → Icon
// ---------------------------------------------------------------------------
function buildPanel() {
  const dc = DIALOUT;
  const title = esc(dc.name);

  // Build directory rows
  const rows = dc.directory.slice(0, 20).map((e, i) => {
    const proto = e.protocol !== 'auto' ? ` [${e.protocol.toUpperCase()}]` : '';
    return `<Row><n>${esc(e.name + proto)}</n><Widget><WidgetId>${WIDGET}e${i}</WidgetId><Name/><Type>Button</Type><Options>size=1;icon=phone</Options></Widget></Row>`;
  }).join('\n');

  // XML structure matches call-macro's getPanelXML output exactly:
  // - Version ALWAYS 1.7
  // - Element order: PanelId, Origin, Type, Color, Name, ActivityType, Icon
  // - No <Location> tag (1.7 doesn't support it)
  const xml = `<Extensions>
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
      <PageId>pex_do_page</PageId>
      <n>${title}</n>
${rows}
<Row><Name/></Row>
<Row><n>Custom Address</n><Widget><WidgetId>${WID_CUSTOM}</WidgetId><n>Dial</n><Type>Button</Type><Options>size=1</Options></Widget></Row>
      <Options/>
    </Page>
      </Panel>
    </Extensions>`;

  L.info('buildPanel', 'XML built', { length: xml.length });
  return xml;
}

async function deployPanel() {
  const panelId = DIALOUT.panelId;
  try { await xapi.Command.UserInterface.Extensions.Panel.Remove({ PanelId: panelId }); } catch { }
  const xml = buildPanel();
  try {
    await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: panelId }, xml);
    L.info('deployPanel', 'OK');
  } catch (e) { L.error('deployPanel', `Failed: ${e.message}`); }
}

// ---------------------------------------------------------------------------
//  Event handlers
// ---------------------------------------------------------------------------
async function onWidget(event) {
  if (event.Type !== 'clicked' || !event.WidgetId.startsWith(WIDGET)) return;
  const wid = event.WidgetId;
  if (wid === WID_CUSTOM) {
    xapi.Command.UserInterface.Message.TextInput.Display({
      FeedbackId: 'pex_do_custom', InputType: 'SingleLine',
      Title: 'Dial Out — Custom Address',
      Text: 'Enter the SIP URI, H.323 address, or Teams address.',
      Placeholder: 'user@example.com', SubmitText: 'Next',
    }).catch(() => { });
    return;
  }
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
  if (event.FeedbackId !== 'pex_do_custom') return;
  const addr = (event.Text || '').trim();
  if (!addr) { notify('Dial Out', 'No address entered.', 3); return; }
  let protocol = 'auto';
  if (/^rtmps?:\/\//i.test(addr)) protocol = 'rtmp';
  if (!(await attach())) return;
  const role = await promptRole(addr);
  if (!role) return;
  await dialOut(addr, protocol, role);
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
}

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