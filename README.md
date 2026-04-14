# Pexip Dial-Out Macro for Cisco Video Endpoints

A Cisco CE/RoomOS macro that adds dial-out functionality to Pexip Infinity VMR conferences from the in-call controls on Cisco video endpoints (DX, SX, MX, Room, Board, Desk series).

## Overview

When a Cisco endpoint is in an active Pexip Infinity conference, this macro adds a **Dial Out** action button to the call controls. Tapping it opens a prompt-based directory browser where users can:

- Browse a pre-configured contact directory with pagination
- Search contacts by name or address
- Dial a custom address via free-form text input
- Choose whether each dialled participant joins as a **Guest** or **Host**

The macro authenticates against the Pexip Client REST API using the active SIP session, automatically inheriting the caller's role — no PIN re-entry required.

## Features

- **Host detection** — only conference Hosts can initiate dial-out; Guests see a notification
- **Role selection** — choose Guest or Host for each dialled participant
- **Directory search** — search by name or address across hundreds of contacts
- **Pagination** — browse 3 contacts per page with Next/Previous navigation
- **Remote directory** *(feature branch)* — fetch the directory from a web server with caching and fallback
- **Protocol auto-detection** — uses `"auto"` by default, deferring to Pexip Call Routing Rules
- **PIN handling** — extracts embedded PINs from the SIP dial string (e.g. `test**1234@domain`) or works transparently when PINs are entered via IVR/DTMF
- **Standalone capable** — runs independently or alongside the Pexip Call Control Macro
- **Self-configuring** — enables HttpClient and manages the HTTP Allow List automatically
- **DX70/CE9 compatible** — uses Prompt dialogs for all UI, avoiding panel widget rendering issues on older firmware

## Requirements

- Cisco CE9.13+ or RoomOS endpoint
- Pexip Infinity deployment with Client REST API enabled
- The endpoint must trust the Pexip node's TLS certificate (upload the CA cert under **Security → Certificates → Custom CA Certificate** on the endpoint)

## Branches

| Branch | File | Description |
|--------|------|-------------|
| **main** | `pexip-dialout-macro.js` | Static directory from settings macro |
| **feature/remote-directory** | `pexip-dialout-macro-remote-directory.js` | Fetches directory from a URL with static fallback |

Both branches share the same `meeting-controls-settings.js` format — the feature branch adds optional fields.

## Files

| File | Description |
|------|-------------|
| `pexip-dialout-macro.js` | Main branch macro — static directory |
| `pexip-dialout-macro-remote-directory.js` | Feature branch macro — remote directory |
| `meeting-controls-settings.js` | Settings macro (main branch example) |
| `meeting-controls-settings-remote.js` | Settings macro (feature branch example) |
| `directory.json` | Example remote directory file to host on a web server |
| `README.md` | This file |

## Installation

### 1. Configure the settings macro

Edit the settings file to match your environment.

**`services`** — defines which Pexip node and conference aliases this macro handles:

```json
"services": [{
  "nodeURL": "https://pexip.example.com/api/client/v2/conferences",
  "regex": "^(.+)@example\\.com$",
  "layouts": ["1:0", "1:7", "ac", "4:0"],
  "shouldMCUMute": false,
  "panelSettings": {
    "controls": ["layout", "overlayText", "lockConference", "muteGuests", "disconnectAll"],
    "roster": true
  }
}]
```

- `nodeURL` — your Pexip Conferencing Node's Client API base URL
- `regex` — regular expression matching the SIP aliases used to dial into your VMRs
- The other fields are used by the call-macro if present; ignored by the dial-out macro but must exist for settings validation

**`dialOut`** — configures the panel button and contact directory:

```json
"dialOut": {
  "panelId": "pex_dialout_panel",
  "name": "Dial Out",
  "icon": "Contacts",
  "color": "#1170CF",
  "directory": [
    { "name": "Sydney Boardroom", "address": "syd.boardroom@example.com" },
    { "name": "Melbourne Conf A", "address": "mel.confa@example.com" },
    { "name": "Jane Smith (Teams)", "address": "jane.smith@contoso.com" },
    { "name": "Livestream", "address": "rtmp://stream.example.com/live/key", "protocol": "rtmp" }
  ]
}
```

The `protocol` field defaults to `"auto"` if omitted — most entries only need `name` and `address`. The directory is sorted alphabetically on load.

### 2. Upload to the endpoint

1. Open the endpoint's web admin interface
2. Navigate to **Customization → Macro Editor**
3. Create a macro named `meeting-controls-settings`, paste the settings content, save
4. Create a macro named `pexip-dialout`, paste the macro content, save, and set to **On**

### 3. TLS Certificate

If your Pexip node uses an internal or self-signed CA certificate:

1. Export the root CA certificate in PEM format
2. On the endpoint web admin, go to **Security → Certificates → Certificate Authorities → Custom CAs**
3. Click **Add certificate authority** and upload the PEM file

Without this, the macro will fail with `SSL peer certificate or SSH remote key was not OK`.

## Remote Directory (Feature Branch)

The feature branch adds the ability to fetch the contact directory from a web server, with automatic caching and fallback to the static directory if the fetch fails.

### Setup

1. Host a `directory.json` file on a web server accessible from the endpoint
2. Add `directoryUrl` and optionally `refreshInterval` to the `dialOut` settings
3. Use `pexip-dialout-macro-remote-directory.js` instead of the main branch macro

### Settings

```json
"dialOut": {
  "panelId": "pex_dialout_panel",
  "name": "Dial Out",
  "icon": "Contacts",
  "color": "#1170CF",
  "directoryUrl": "https://intranet.example.com/pexip/directory.json",
  "refreshInterval": 300,
  "directory": [
    { "name": "NOC Bridge", "address": "noc.bridge@example.com" }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `directoryUrl` | string | — | URL to fetch the JSON directory from |
| `refreshInterval` | number | `0` | Seconds to cache fetched directory before re-fetching. `0` = fetch every time the panel opens |
| `directory` | array | — | Static fallback contacts used when the remote fetch fails |

### JSON Format

The URL should return one of these formats:

**Plain array:**
```json
[
  { "name": "Room Alpha", "address": "alpha@example.com" },
  { "name": "H.323 Room", "address": "10.0.1.50", "protocol": "h323" }
]
```

**Wrapper object:**
```json
{
  "directory": [
    { "name": "Room Alpha", "address": "alpha@example.com" }
  ]
}
```

Each entry requires `name` and `address`. The `protocol` field is optional (defaults to `"auto"`).

### How It Works

1. On macro startup, the directory is pre-fetched from the URL (non-blocking)
2. Each time the user taps "Dial Out", the macro checks the cache age against `refreshInterval`
3. If the cache is stale or empty, it fetches fresh data from the URL
4. If the fetch fails (server down, network issue, bad JSON), it falls back to the static `directory` array
5. The main menu shows **(remote)** or **(local)** so the user can tell which source is active
6. The directory URL hostname is automatically added to the HTTP Allow List

### Web Server Requirements

- Must serve valid JSON with `Content-Type: application/json`
- Must be reachable from the Cisco endpoint's network
- If using HTTPS (recommended), the endpoint must trust the server's TLS certificate
- The hostname is automatically added to the endpoint's HTTP Allow List (max 10 entries)

### Hosting Options

- **Static file on any web server** — nginx, Apache, IIS, S3 bucket
- **Pexip Management Node** — host the file on the same server as your Pexip admin interface
- **Internal API endpoint** — generate the directory dynamically from your directory service, CUCM, or Pexip Management API

## User Guide

### Dial-out flow

1. Join a Pexip VMR conference from the Cisco endpoint
2. Tap the **Dial Out** action button in the call controls
3. Choose from the main menu:
   - **Browse Directory** — page through contacts 3 at a time
   - **Search by Name** — type a name or address fragment to filter
   - **Dial Custom Address** — enter any SIP/H.323/Teams address
4. Select a contact to see their name and address
5. Choose **Dial as Guest** or **Dial as Host**
6. The participant is dialled into the conference

### Navigation

- Prompts show 3 contacts per page with **Next →** and **← Previous** buttons
- Search results are browseable with the same pagination
- **Back** returns to the previous page; **Cancel** closes the dialog
- If no results match a search, choose **Search Again** or **Browse All**

## Settings Reference

### `dialOut` object

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `panelId` | string | No | `pex_dialout_panel` | Panel identifier |
| `name` | string | No | `Dial Out` | Action button label |
| `icon` | string | No | `Contacts` | Button icon |
| `color` | string | No | — | Button colour as hex (e.g. `#1170CF`) |
| `directory` | array | Yes | — | Array of contact entries (static / fallback) |
| `directoryUrl` | string | No | — | URL to fetch remote directory *(feature branch)* |
| `refreshInterval` | number | No | `0` | Cache duration in seconds *(feature branch)* |

### Directory entry object

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Display name shown in prompts |
| `address` | string | Yes | — | SIP URI, H.323 address, or Teams address |
| `protocol` | string | No | `auto` | Protocol for the call |

### Protocol values

| Value | Description |
|-------|-------------|
| `auto` | Let Pexip Call Routing Rules determine the protocol (recommended) |
| `h323` | Force H.323 |
| `mssip` | Microsoft Teams via Pexip CVI gateway |
| `rtmp` | RTMP streaming target |

> **Note:** On Pexip Infinity v35+ (version_id 40+), the Client API `/dial` endpoint requires `"auto"` for SIP calls routed via Call Routing Rules. Using `"sip"` directly may return `unsupported protocol 'sip'`.

### Scaling the directory

**Static (main branch):** The settings macro can hold **500+ entries** within the 64KB macro content limit. Each entry is approximately 100 bytes.

**Remote (feature branch):** No practical limit — the directory is fetched over HTTP and not constrained by the macro content limit. The endpoint's memory is the only limit.

Minimal entry format (protocol defaults to `"auto"`):
```json
{ "name": "Room Alpha", "address": "alpha@example.com" }
```

## How It Works

### Authentication

1. The macro extracts the **SIP Session ID** from the active call
2. It sends `POST /api/client/v2/conferences/<sessionId>/request_token` — this inherits the SIP call's authentication context, so no PIN is needed even for PIN-protected VMRs
3. The token response includes the caller's `role` (`HOST` or `GUEST`)
4. All subsequent API calls use the same session ID path

### Dial-out API

The macro sends `POST /api/client/v2/conferences/<sessionId>/dial` with:
```json
{ "destination": "user@example.com", "protocol": "auto", "role": "GUEST" }
```

### Running with the Pexip Call Control Macro

When running alongside the call-macro (v1.8.0):

- Both macros read from the same `meeting-controls-settings` macro
- The `dialOut` section is ignored by the call-macro
- HttpClient and Allow List setup is idempotent — safe for both macros
- Each macro manages its own API token independently

### Running standalone

When running without the call-macro:

- The macro enables `HttpClient.Mode` automatically
- It extracts hostnames from `nodeURL` (and `directoryUrl` on the feature branch) and adds them to the HTTP Allow List
- The `services` array must still be present for alias matching

## Troubleshooting

### Common errors

| Log message | Cause | Fix |
|-------------|-------|-----|
| `SSL peer certificate or SSH remote key was not OK` | Endpoint doesn't trust the TLS cert | Upload CA cert to endpoint |
| `HTTP 403` on `request_token` | No active SIP session to inherit auth from | Ensure you're in an active Pexip call before tapping Dial Out |
| `HTTP 400` on `dial` | Invalid protocol or destination not routable | Use `"auto"` protocol; check Pexip admin logs |
| `unsupported protocol 'sip'` (Pexip log) | Pexip v35+ requires `"auto"` for Call Routing Rules | Change protocol to `"auto"` |
| `No valid settings macro found` | Settings macro missing or incomplete | Ensure macro is named `meeting-controls-settings` with `services` and `dialOut` |
| `Only Hosts can dial out` | Caller joined as Guest | Join with Host PIN or configure VMR to grant Host role |
| `Remote directory unavailable, will use static fallback` | Directory URL unreachable | Check URL, network, TLS cert, and Allow List |
| `Fetch failed: HTTP 404` | Directory file not found on server | Verify URL path and file exists on web server |

### Viewing logs

Macro logs appear in the endpoint's macro console (**Customization → Macro Editor → Console**). Key log entries:

```
v4.1.0 INFO  [loadSettings] Loaded from "meeting-controls-settings"
v4.1.0 INFO  [acquireToken] Token acquired {"role":"HOST"}
v4.1.0 INFO  [dialOut] Success: user@example.com {"result":["uuid..."]}
```

Feature branch additional logs:
```
v4.2.0 INFO  [fetchRemoteDirectory] GET https://intranet.example.com/pexip/directory.json
v4.2.0 INFO  [fetchRemoteDirectory] Fetched 30 entries {"first":"Adelaide Office"}
v4.2.0 INFO  [getDirectory] Remote unavailable, using static fallback
v4.2.0 INFO  [fetchRemoteDirectory] Using cached (120s of 300s)
```

### Pexip admin logs

If dial-out fails with a 400, check the Pexip Infinity admin logs (**Status → Logs**) and search for `REST API call failed` to see the specific error.

## DX70/CE9 Notes

The macro uses Prompt dialogs (`Message.Prompt.Display`) for all user interaction rather than panel widgets. This is because the DX70 running CE9.x firmware has a known limitation where programmatically saved panel XML with `<n>` (lowercase) tags renders blank labels. Prompt dialogs render text correctly on all CE9 endpoints.

The action button label uses `<Name>` (capital N) which is the format the DX70's native UI Extensions editor exports. If the button label doesn't appear after deploying the macro, manually set the name in the UI Extensions editor as a one-time step.

## Version History

| Version | Branch | Changes |
|---------|--------|---------|
| v4.2.0 | feature/remote-directory | Remote directory fetch with caching and fallback |
| v4.1.0 | main | Current stable — `<Name>` tag for DX70, prompt-based UI |
| v4.0.0 | main | Prompt-based UI replacing panel widgets |
| v3.x | — | Panel widget iterations (blank labels on DX70) |
| v3.0.0 | — | Standalone capable (HttpClient, Allow List) |
| v2.3.0 | — | Session ID for all API paths; protocol `"auto"` |
| v2.0.0 | — | Host check, role selection prompt |
| v1.1.0 | — | Initial release |

## License

This macro is provided as-is for use with Pexip Infinity and Cisco video endpoints.