# QuokkaDispatcher - FiveM External Dispatch Console

A desktop application for FiveM dispatch operators that enables them to manage incoming phone calls and radio communications from in-game players using pma-voice and mm_radio.

## Features

- **Radio Control**: Join/leave radio channels and transmit with push-to-talk
- **Call Management**: Receive, answer, and manage incoming calls from players
- **Real-time Updates**: Live radio channel player list showing who's talking
- **Call Duration Tracking**: Displays how long each call has been active
- **Persistent Settings**: Automatically saves connection settings to localStorage

## Project Structure

```
quokkadispatcher/
├── electron-app/                 # Electron desktop application
│   ├── main.js                   # Electron main process
│   ├── preload.js                # Preload script (security bridge)
│   ├── package.json              # Electron app dependencies
│   └── src/
│       ├── index.html            # Main UI
│       ├── css/style.css         # Styling
│       ├── js/
│       │   ├── app.js            # Main application logic
│       │   ├── ui.js             # UI state management
│       │   └── lib/ws-client.js  # WebSocket client library
│       └── assets/sounds/        # Audio files
│
└── fivem-resource/               # FiveM Server Resource
    ├── fxmanifest.lua            # Resource manifest
    ├── config.lua                # Configuration
    ├── server/
    │   ├── main.lua              # Server logic & exports
    │   ├── websocket.js          # WebSocket server
    │   ├── radio.lua             # Radio functionality
    │   └── phone.lua             # Phone call functionality
    └── client/
        └── main.lua              # Client-side dispatcher setup
```

## Setup Instructions

### Prerequisites

- Node.js and npm
- FiveM server with `pma-voice` and `ox_lib` resources
- Windows PC for running the Electron app

### 1. Configure FiveM Resource

1. Copy the `fivem-resource` folder to your FiveM resources folder
2. Edit `fivem-resource/config.lua`:
   ```lua
   Config.AuthToken = 'your-secure-random-token-here'
   Config.DispatcherIdentifiers = {
       'license:xxxxxx...',  -- Add dispatcher player licenses here
   }
   ```
3. Add to your server.cfg:
   ```
   ensure quokkadispatcher
   set qd_ws_port 30125
   set qd_voice_ws_port 30130
   set qd_auth_token your-secure-random-token-here
   ```

### 2. Set Up Electron App

```bash
cd electron-app
npm install
```

### 3. Run the Application

Development:
```bash
npm start
```

Build for distribution:
```bash
npm run build
```

## Usage

1. **Start the FiveM server** with QuokkaDispatcher resource enabled
2. **Launch the Electron app** (`npm start` or the built executable)
3. **Configure connection**:
   - Server URL: `ws://127.0.0.1:30125` (or your server's IP)
   - Auth Token: The token from config.lua
   - Dispatcher License: Your FiveM license identifier
4. **Click Connect** to establish connection
5. **Join a radio channel** (1-500)
6. **Answer incoming calls** when they arrive

## WebSocket Message Protocol

### Client → Server

- **LINK_DISPATCHER**: Associate WebSocket client with a dispatcher player
- **JOIN_RADIO**: Join a radio channel
- **LEAVE_RADIO**: Leave current radio channel
- **START_RADIO_TALK**: Start transmitting on radio
- **STOP_RADIO_TALK**: Stop transmitting
- **ANSWER_CALL**: Accept an incoming call
- **END_CALL**: Disconnect an active call
- **REJECT_CALL**: Reject an incoming call

### Server → Client

- **DISPATCHER_LINKED**: Successfully linked to a dispatcher
- **INCOMING_CALL**: New call received (callId, callerName, callerSource)
- **CALL_ANSWERED**: Call was answered (callId)
- **CALL_ENDED**: Call terminated (callId)
- **RADIO_JOINED**: Successfully joined radio channel (channel number)
- **RADIO_LEFT**: Left radio channel (channel number)
- **RADIO_STATE**: Current players on radio channel
- **VOICE_CONTEXT**: Current voice context (`source=1 radio`, `source=2 call`)
- **ERROR**: Error message

## Voice Relay Protocol

QuokkaDispatcher now hosts a server-side voice relay endpoint:

- Dispatcher playback: `ws://<server-ip>:30130/voice/dispatcher`
- Voice ingest (external voice backend): `ws://<server-ip>:30130/voice/ingest`

The Electron app derives the playback URL from the control WebSocket host and connects automatically.

## Configuration

### FiveM Config (config.lua)

| Setting | Default | Description |
|---------|---------|-------------|
| AuthToken | 'CHANGE_ME_SECURE_RANDOM_TOKEN' | Secret token for authentication |
| WebSocketPort | 30125 | WebSocket server port |
| DispatcherIdentifiers | {} | Array of allowed dispatcher licenses |
| DispatcherBucket | 0 | Routing bucket for dispatchers (0 = default) |
| SpawnPosition | (0,0,-200,0) | Where dispatcher ped spawns (hidden) |
| MaxDispatchers | 5 | Maximum concurrent dispatcher connections |
| RadioPollRate | 500ms | How often to update radio channel state |
| CallChannelMin/Max | 10000-99999 | Phone call VOIP channel range |

## Audio Requirements

Place a `.wav` file at `electron-app/assets/sounds/incoming-call.wav` for incoming call notifications.

## Development Notes

- The dispatcher is a hidden, invisible player in the game world
- Controls are disabled except for Push-to-Talk
- Radio and phone audio uses pma-voice's VOIP channels
- WebSocket connection is constantly monitored with ping/pong keepalive

## Troubleshooting

### Connection Issues
- Verify firewall allows WebSocket port 30125
- Check that auth token matches exactly in config.lua
- Ensure dispatcher license is correct (from GetPlayerIdentifiers)

### Audio Issues
- Confirm pma-voice and ox_lib are running on server
- Check that players can talk normally before testing dispatcher

### Performance
- Reduce Config.RadioPollRate if experiencing lag
- Limit Config.MaxDispatchers if server is under load

## License

This project is provided as-is for use with FiveM servers.

## Support

For issues or questions, ensure:
1. All resources start without errors in server console
2. The WebSocket server is listening (check server logs)
3. Your firewall isn't blocking the WebSocket port
4. Your FiveM license is in the DispatcherIdentifiers list

## Voice Session Binding

Control WebSocket now sends a `WS_SESSION` message with `wsClientId` on connect. Electron uses this ID when connecting to `/voice/dispatcher` so server-side voice routing can follow each dispatcher's current radio/call context.

## Voice Ingest Routing Header (`QDRT`)

Producers sending to `ws://<server-ip>:30130/voice/ingest` should send binary frames with:

- `magic` (4): ASCII `QDRT`
- `version` (u8): `1`
- `sourceType` (u8): `1=radio`, `2=call`
- `routeId` (u16 LE): radio channel or call channel ID
- `payloadLen` (u16 LE): payload size
- `payload`: audio packet bytes (recommended `QDAV` payload)

The relay forwards payload only to dispatchers whose context matches `routeId` for that source type.

## Server Export For pma-voice Forks

If your pma-voice fork/backend can access voice packet bytes, you can ingest directly via export:

```lua
exports['quokkadispatcher']:ingestRoutedVoicePayload(sourceType, routeId, payloadB64)
```

- `sourceType`: `1` for radio, `2` for call
- `routeId`: radio channel or call channel ID
- `payloadB64`: base64 encoded `QDAV` packet bytes

Patch template files are included at:

- `QuokkaDispatcher/integrations/pma-voice/PATCH_TEMPLATE.md`
- `QuokkaDispatcher/integrations/pma-voice/example_qdav_forward.lua`
