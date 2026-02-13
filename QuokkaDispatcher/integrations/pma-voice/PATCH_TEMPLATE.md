# pma-voice Fork Patch Template

This template shows where and how to forward voice frames from a pma-voice fork/backend into QuokkaDispatcher.

## Target export

Call this server export for every encoded/decoded packet you want dispatchers to hear:

```lua
exports['quokkadispatcher']:ingestRoutedVoicePayload(sourceType, routeId, payloadB64)
```

- `sourceType`: `1` for radio, `2` for call
- `routeId`: radio channel ID (for sourceType=1) or call channel ID (for sourceType=2)
- `payloadB64`: base64 of the full `QDAV` packet bytes

## Packet format required by QuokkaDispatcher

Build a `QDAV` packet and base64 it before export call.

Header (24 bytes, little-endian):
- `magic`(4): `QDAV`
- `version`(u8): `1`
- `source`(u8): `1` radio, `2` call
- `codec`(u8): `1` Opus, `2` PCM16LE
- `channels`(u8)
- `sampleRate`(u16)
- `payloadLen`(u16)
- `sequence`(u32)
- `timestampMs`(u64)
- payload bytes

## Integration points in your fork

Hook where pma-voice has access to outgoing voice frame bytes and route metadata:

1. Radio frame path:
- You know player's current radio channel (`radioChannel`)
- Build `QDAV` with `source=1`
- Call export with `sourceType=1`, `routeId=radioChannel`

2. Call frame path:
- You know active call channel (`callChannel`)
- Build `QDAV` with `source=2`
- Call export with `sourceType=2`, `routeId=callChannel`

## Minimal pseudo-code (fork side)

```lua
-- pseudo: implement these with your fork internals
local function onVoiceFrame(frameBytes, codec, channels, sampleRate, isRadio, radioChannel, callChannel)
    local sourceType = isRadio and 1 or 2
    local routeId = isRadio and radioChannel or callChannel
    if not routeId or routeId <= 0 then return end

    local qdav = BuildQdavPacket({
        source = sourceType,
        codec = codec,          -- 1 Opus, 2 PCM16LE
        channels = channels,
        sampleRate = sampleRate,
        payload = frameBytes,
    })

    local payloadB64 = Base64Encode(qdav)
    exports['quokkadispatcher']:ingestRoutedVoicePayload(sourceType, routeId, payloadB64)
end
```

## Notes

- Do not send plain frame bytes without `QDAV` envelope.
- Keep packet cadence small (e.g., 20ms frames).
- Opus is preferred for bandwidth.
- The server relay routes by `routeId` using dispatcher state from QuokkaDispatcher radio/call context.