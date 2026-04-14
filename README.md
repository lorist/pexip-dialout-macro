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
- **Protocol auto-detection** — uses `"auto"` by default, deferring to Pexip Call Routing Rules
- **PIN handling** — extracts embedded PINs from the SIP dial string (e.g. `test**1234@domain`) or works transparently when PINs are entered via IVR/DTMF
- **Standalone capable** — runs independently or alongside the Pexip Call Control Macro
- **Self-configuring** — enables HttpClient and manages the HTTP Allow List automatically
- **DX70/CE9 compatible** — uses Prompt dialogs for all UI, avoiding panel widget rendering issues on older firmware

## Requirements

- Cisco CE9.13+ or RoomOS endpoint
- Pexip Infinity deployment with Client REST API enabled
- The endpoint must trust the Pexip node's TLS certificate (upload the CA cert under **Security → Certificates → Custom CA Certificate** on the endpoint)

## Files

| File | Description |
|------|-------------|
| `pexip-dialout-macro.js` | The dial-out macro — upload as a macro and set to **On** |
| `meeting-controls-settings.js` | Shared settings macro — upload as a macro (can be **On** or **Off**) |
| `README.md` | This file |

## Installation

### 1. Configure the settings macro

Edit `meeting-controls-settings.js` to match your environment.

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
- The other fields (`layouts`, `shouldMCUMute`, `panelSettings`) are used by the call-macro if present; ignored by the dial-out macro but must exist for settings validation

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
| `directory` | array | Yes | — | Array of contact entries |

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

The settings macro can hold **500+ directory entries** within the 64KB macro content limit. Each entry is approximately 100 bytes. The search and pagination features handle large directories efficiently — users can find contacts by name without scrolling through hundreds of entries.

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
- It extracts the Pexip hostname from `nodeURL` and adds it to the HTTP Allow List
- The `services` array must still be present for alias matching

## Troubleshooting

### Common errors

| Log message | Cause | Fix |
|-------------|-------|-----|
| `SSL peer certificate or SSH remote key was not OK` | Endpoint doesn't trust the Pexip TLS cert | Upload CA cert to endpoint |
| `HTTP 403` on `request_token` | No active SIP session to inherit auth from | Ensure you're in an active Pexip call before tapping Dial Out |
| `HTTP 400` on `dial` | Invalid protocol or destination not routable | Use `"auto"` protocol; check Pexip admin logs |
| `unsupported protocol 'sip'` (Pexip log) | Pexip v35+ requires `"auto"` for Call Routing Rules | Change protocol to `"auto"` |
| `No valid settings macro found` | Settings macro missing or incomplete | Ensure macro is named `meeting-controls-settings` with `services` and `dialOut` |
| `Only Hosts can dial out` | Caller joined as Guest | Join with Host PIN or configure VMR to grant Host role |

### Viewing logs

Macro logs appear in the endpoint's macro console (**Customization → Macro Editor → Console**). Filter for version string `v4.1.0` to see only this macro's output:

```
v4.1.0 INFO  [loadSettings] Loaded from "meeting-controls-settings"
v4.1.0 INFO  [acquireToken] Token acquired {"role":"HOST"}
v4.1.0 INFO  [dialOut] Success: user@example.com {"result":["uuid..."]}
```

### Pexip admin logs

If dial-out fails with a 400, check the Pexip Infinity admin logs (**Status → Logs**) and search for `REST API call failed` to see the specific error.

## DX70/CE9 Notes

The macro uses Prompt dialogs (`Message.Prompt.Display`) for all user interaction rather than panel widgets. This is because the DX70 running CE9.x firmware has a known limitation where `<n>` (lowercase) tags in programmatically saved panel XML are not rendered — resulting in blank labels. Prompt dialogs render text correctly on all CE9 endpoints.

The action button label uses `<Name>` (capital N) which is the format the DX70's native UI Extensions editor exports.

## Version History

| Version | Changes |
|---------|---------|
| v4.1.0 | Current — `<Name>` tag for DX70 button label |
| v4.0.0 | Prompt-based UI replacing panel widgets |
| v3.x | Panel widget iterations (blank labels on DX70) |
| v3.0.0 | Standalone capable (HttpClient, Allow List) |
| v2.3.0 | Session ID for all API paths; protocol `"auto"` |
| v2.0.0 | Host check, role selection prompt |
| v1.1.0 | Initial release |

## License

This macro is provided as-is for use with Pexip Infinity and Cisco video endpoints.