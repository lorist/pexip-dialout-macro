const meeting_controls_settings = {
  "services": [
    {
      "nodeURL": "https://<infinity.example.com>/api/client/v2/conferences",
      "layouts": ["1:0", "1:7", "ac", "4:0"],
      "regex": "^(.+)@<domain\\.com>$",
      "shouldMCUMute": false,
      "panelSettings": {
        "controls": [
          "layout",
          "overlayText",
          "lockConference",
          "muteGuests",
          "disconnectAll"
        ],
        "roster": true
      }
    }
  ],
  "InCallButton": {
    "panelId": "panel_pex_in",
    "type": "InCall",
    "icon": "Info",
    "name": "Meeting Controls"
  },
  "LayoutButton": {
    "panelId": "layout_panel",
    "type": "Never",
    "icon": "Info",
    "name": "Change Layout"
  },
  "dialOut": {
    "panelId": "pex_dialout_panel",
    "name": "Dial Out",
    "icon": "Contacts",
    "color": "#1170CF",
    "directory": [
      { "name": "Sydney DX80", "address": "dx80@example.com", "protocol": "auto" },
      { "name": "Boardroom (H.323)", "address": "10.0.1.50", "protocol": "auto" },
      { "name": "Teams - Jane Doe", "address": "jane.doe@contoso.com", "protocol": "auto" }
    ]
  }
}