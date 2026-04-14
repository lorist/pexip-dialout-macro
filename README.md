# Pexip Dial-Out Macro for Cisco Video Endpoints

A Cisco CE/RoomOS macro that adds dial-out functionality to Pexip Infinity VMR conferences from the in-call controls on Cisco video endpoints (DX, SX, MX, Room, Board, Desk series).

## Overview

When a Cisco endpoint is in an active Pexip Infinity conference, this macro presents a **Dial Out** panel in the call controls. From this panel, users can:

- Dial pre-configured directory contacts into the conference with one tap
- Dial a custom address via a free-form text input
- Choose whether each dialled participant joins as a **Guest** or **Host**

The macro authenticates against the Pexip Client REST API using the active SIP session, automatically inheriting the caller's role — no PIN re-entry required.

## Features

- **Host detection** — only conference Hosts can initiate dial-out; Guests see a notification
- **Role selection prompt** — choose Guest or Host for each dialled participant
- **Protocol auto-detection** — uses `"auto"` by default, deferring to Pexip Call Routing Rules
- **PIN handling** — extracts embedded PINs from the SIP dial string (e.g. `test**1234@domain`) or works transparently when PINs are entered via IVR/DTMF
- **Standalone capable** — runs independently or alongside the Pexip Call Control Macro (call-macro)
- **Self-configuring** — enables HttpClient and manages the HTTP Allow List automatically

## Requirements

- Cisco CE9.13+ or RoomOS endpoint
- Pexip Infinity deployment with Client REST API enabled
- The endpoint must trust the Pexip node's TLS certificate (upload the CA cert under **Security → Certificates → Custom CA Certificate** on the endpoint)

## Files

| File | Description |
|------|-------------|
| `pexip-dialout-macro.js` | The dial-out macro — upload as a macro and set to **On** |
| `meeting-controls-settings.js` | Shared settings macro — upload as a macro (can be **On** or **Off**) |

## Installation

### 1. Configure the settings macro

Edit `meeting-controls-settings.js` to match your environment. The key sections are:

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
- `regex` — a regular expression matching the SIP aliases used to dial into your VMRs
- The other fields (`layouts`, `shouldMCUMute`, `panelSettings`) are used by the call-macro if present; they are ignored by the dial-out macro but must exist for settings validation

**`dialOut`** — configures the dial-out panel and directory:

```json
"dialOut": {
  "panelId": "pex_dialout_panel",
  "name": "Dial Out",
  "icon": "Contacts",
  "color": "#1170CF",
  "directory": [
    { "name": "Room Alpha", "address": "alpha@example.com", "protocol": "auto" },
    { "name": "H.323 Room", "address": "10.0.1.50", "protocol": "auto" },
    { "name": "Teams User", "address": "user@contoso.com", "protocol": "auto" }
  ]
}
```

### 2. Upload to the endpoint

1. Open the endpoint's web admin interface
2. Navigate to **Customization → Macro Editor**
3. Create a macro named `meeting-controls-settings`, paste the settings content, save (set to On or Off — either works)
4. Create a macro named `pexip-dialout`, paste the macro content, save, and set to **On**

### 3. TLS Certificate

If your Pexip node uses an internal or self-signed CA certificate:

1. Export the root CA certificate in PEM format
2. On the endpoint web admin, go to **Security → Certificates → Certificate Authorities → Custom CAs**
3. Click **Add certificate authority** and upload the PEM file

Without this, the macro will fail with `SSL peer certificate or SSH remote key was not OK`.

## Settings Reference

### `dialOut` object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `panelId` | string | No | Panel identifier (default: `pex_dialout_panel`) |
| `name` | string | No | Panel button label (default: `Dial Out`) |
| `icon` | string | No | Panel icon name (default: `Contacts`) |
| `color` | string | No | Panel button colour as hex (e.g. `#1170CF`) |
| `directory` | array | Yes | Array of contact entries |

### Directory entry object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name shown on the panel button |
| `address` | string | Yes | SIP URI, H.323 address, or Teams address to dial |
| `protocol` | string | No | Protocol for the call (default: `auto`) |

### Protocol values

| Value | Description |
|-------|-------------|
| `auto` | Let Pexip Call Routing Rules determine the protocol (recommended) |
| `sip` | Force SIP (may not work on all Pexip versions via Client API) |
| `h323` | Force H.323 |
| `mssip` | Microsoft Teams via Pexip CVI gateway |
| `rtmp` | RTMP streaming target |

> **Note:** On Pexip Infinity v35+ (version_id 40+), the Client API `/dial` endpoint requires `"auto"` for SIP calls routed via Call Routing Rules. Using `"sip"` directly returns `unsupported protocol 'sip'`.

## How It Works

### Authentication flow

1. The macro extracts the **SIP Session ID** from the active call via `xapi.Status.Conference.Call[n].Sip.SessionId`
2. It sends `POST /api/client/v2/conferences/<sessionId>/request_token` — this inherits the SIP call's authentication context, so no PIN is needed
3. The token response includes the caller's `role` (`HOST` or `GUEST`)
4. All subsequent API calls (dial, refresh, release) use the same session ID path

### Dial-out flow

1. User taps a directory contact or enters a custom address
2. A prompt asks: "Dial as Guest or Host?"
3. The macro sends `POST /api/client/v2/conferences/<sessionId>/dial` with `{ destination, protocol, role }`
4. On-screen alerts show the dial-out status

### Running with the call-macro

When running alongside the Pexip Call Control Macro (call-macro v1.8.0):

- Both macros read from the same `meeting-controls-settings` macro
- The `dialOut` section is ignored by the call-macro (it only validates its own expected fields)
- HttpClient and Allow List setup is idempotent — safe for both macros to call
- Each macro manages its own API token independently

### Running standalone

When running without the call-macro:

- The macro enables `HttpClient.Mode` automatically
- It extracts the Pexip hostname from `nodeURL` and adds it to the HTTP Allow List
- The `services` array must still be present for alias matching and node URL resolution

## Troubleshooting

### Common errors

| Log message | Cause | Fix |
|-------------|-------|-----|
| `SSL peer certificate or SSH remote key was not OK` | Endpoint doesn't trust the Pexip TLS cert | Upload CA cert to endpoint |
| `HTTP 403` on `request_token` | VMR has a host PIN and no SIP session context | Ensure you're in an active Pexip call before opening the panel |
| `HTTP 400` on `dial` | Invalid protocol or request body | Use `"auto"` protocol; check Pexip admin logs for detail |
| `unsupported protocol 'sip'` (Pexip log) | Pexip v35+ requires `"auto"` for Call Routing Rule-based dialling | Change protocol to `"auto"` in settings |
| `No valid settings macro found` | Settings macro not found or missing required fields | Ensure macro is named `meeting-controls-settings` with `services` and `dialOut` sections |
| Panel shows blank labels | DX70/CE9 XML rendering issue | Known issue on DX70; functionality works despite blank labels |

### Checking the logs

Macro logs appear in the endpoint's macro console. Filter for `pexip-dialout` to see only this macro's output. Key log entries:

```
v3.2.0 INFO  [loadSettings] Loaded from "meeting-controls-settings"
v3.2.0 INFO  [acquireToken] Token acquired {"role":"HOST",...}
v3.2.0 INFO  [dialOut] Success: user@example.com {"result":["uuid..."]}
```

### Pexip admin logs

If dial-out fails with a 400, check the Pexip Infinity admin logs for the specific error. Navigate to **Status → Logs** on the management node and search for `REST API call failed`.

## Known Issues

- **DX70 panel labels** — row names and page titles may not render on DX70 endpoints running CE9.x firmware. The buttons are functional and the role selection prompt displays contact names correctly. This is a firmware-level UI Extensions rendering limitation.
- **Multiple concurrent tokens** — both this macro and the call-macro request separate API tokens for the same conference. This is by design and Pexip handles multiple tokens per conference without issue.

## Version History

| Version | Changes |
|---------|---------|
| v3.2.0 | Current release — standalone capable, host check, role selection, session ID auth |
| v2.3.0 | Session ID for all API paths; protocol `"auto"` |
| v2.0.0 | Clean rewrite with host detection and role selection prompt |
| v1.1.0 | Initial release — companion to call-macro |

## License

This macro is provided as-is for use with Pexip Infinity and Cisco video endpoints. Not affiliated with or endorsed by Cisco Systems or Pexip.