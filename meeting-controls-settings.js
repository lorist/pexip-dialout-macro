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
    "directory": [
      { "name": "Sydney Pod5", "address": "syd.pod5@example.com" },
      { "name": "Sydney Boardroom", "address": "syd.boardroom@example.com" },
      { "name": "Sydney Reception", "address": "syd.reception@example.com" },
      { "name": "Melbourne Conf Room A", "address": "mel.confa@example.com" },
      { "name": "Melbourne Conf Room B", "address": "mel.confb@example.com" },
      { "name": "Melbourne Executive", "address": "mel.exec@example.com" },
      { "name": "Brisbane Huddle 1", "address": "bne.huddle1@example.com" },
      { "name": "Brisbane Huddle 2", "address": "bne.huddle2@example.com" },
      { "name": "Brisbane Training", "address": "bne.training@example.com" },
      { "name": "Perth Main", "address": "per.main@example.com" },
      { "name": "Perth Breakout", "address": "per.breakout@example.com" },
      { "name": "Adelaide Office", "address": "adl.office@example.com" },
      { "name": "Canberra Secure Room", "address": "cbr.secure@example.com" },
      { "name": "Auckland NZ", "address": "akl.main@example.com" },
      { "name": "Wellington NZ", "address": "wlg.main@example.com" },
      { "name": "Tokyo Office", "address": "tyo.office@example.com" },
      { "name": "Singapore Hub", "address": "sin.hub@example.com" },
      { "name": "London Office", "address": "lon.office@example.com" },
      { "name": "Washington DC", "address": "wdc.main@example.com" },
      { "name": "Jane Smith (Teams)", "address": "jane.smith@contoso.com" },
      { "name": "Bob Jones (Teams)", "address": "bob.jones@contoso.com" },
      { "name": "Alice Wong", "address": "alice.wong@example.com" },
      { "name": "David Chen", "address": "david.chen@example.com" },
      { "name": "Sarah Park", "address": "sarah.park@example.com" },
      { "name": "NOC Bridge", "address": "noc.bridge@example.com" },
      { "name": "All Hands VMR", "address": "allhands@example.com" },
      { "name": "External Partner A", "address": "partner.a@external.com" },
      { "name": "External Partner B", "address": "partner.b@external.com" },
      { "name": "Test Endpoint", "address": "test.endpoint@example.com" },
      { "name": "Livestream (RTMP)", "address": "rtmp://stream.example.com/live/key", "protocol": "rtmp" }
    ]
  }
}