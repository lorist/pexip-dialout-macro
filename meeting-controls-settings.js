const meeting_controls_settings = {
  "services": [
    {
      "nodeURL": "https://pexip.example.com/api/client/v2/conferences",
      "layouts": ["1:0", "1:7", "ac", "4:0"],
      "regex": "^(.+)@example\\.com$",
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
    "directoryUrl": "https://intranet.example.com/pexip/directory.json",
    "refreshInterval": 300,
    /*! if you want to have a local copy you can add them here:
    "directory": [
      { "name": "Sydney Pod5 - 2", "address": "syd.pod5@example.com" },
      { "name": "NOC Bridge", "address": "noc.bridge@example.com" }
    ]
      */
  }
}