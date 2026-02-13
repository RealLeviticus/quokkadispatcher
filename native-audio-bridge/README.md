# Native Audio Bridge (Starter)

This folder bootstraps a low-latency path for forwarding in-game voice packets into the Electron app.

## Endpoints

- Producer (C++/Rust capture process): `ws://127.0.0.1:30130/voice-relay/ingest`
- Consumer (Electron renderer): `ws://127.0.0.1:30130/voice-relay`

The relay server is hosted by `electron-app/main.js`.

## Packet framing (`QDAV` v1)

Binary packets must use this little-endian header before payload bytes:

- `magic` (4 bytes): ASCII `QDAV`
- `version` (u8): `1`
- `source` (u8): `1=radio`, `2=000 call`
- `codec` (u8): `1=Opus`, `2=PCM16LE`
- `channels` (u8): `1` or `2`
- `sample_rate` (u16): typically `48000`
- `payload_len` (u16): payload byte length
- `sequence` (u32): incrementing packet counter per stream
- `timestamp_ms` (u64): unix epoch milliseconds
- `payload` (`payload_len` bytes)

Header size is fixed at 24 bytes.

## Current status

- Electron relay: implemented (binary + metadata passthrough).
- Electron playback: implemented for PCM16 packets.
- Opus playback: transport-ready; decoder hookup still pending.
- Rust forwarder: implemented with a synthetic audio source for bring-up.
- C++ forwarder: packet builder + interface stubs ready for capture integration.

## Rust quick start

```powershell
cd native-audio-bridge/rust-forwarder
cargo run -- --endpoint ws://127.0.0.1:30130/voice-relay/ingest --codec pcm16
```

This sends test PCM packets so you can verify end-to-end relay and playback.

## Next integration step

Replace the synthetic source in `rust-forwarder/src/main.rs` (or implement the C++ sender) with your in-game capture callback that yields Opus or PCM frames tagged as radio (`source=1`) or `/000` (`source=2`).