# Bundled Audio Forwarder Binary

Place the native forwarder binary in this folder before building Electron.

## Expected binary names

- Windows: `qd-audio-forwarder.exe`
- macOS: `qd-audio-forwarder-macos`
- Linux: `qd-audio-forwarder-linux`

During packaging (`npm run build`), `electron-builder` copies `electron-app/bin/**` into the app resources under `resources/bin/`.

At runtime, Electron auto-starts the binary and passes:

- `--endpoint ws://127.0.0.1:30130/voice-relay/ingest`
- `--codec pcm16` (override with `QD_AUDIO_CODEC`)
- `--source 1` (override with `QD_AUDIO_SOURCE`)

## Runtime overrides (optional)

- `QD_AUDIO_FORWARDER_PATH`: absolute path to binary (bypasses bundled lookup)
- `QD_AUDIO_FORWARDER_ARGS`: extra arguments appended to defaults
- `QD_AUDIO_FORWARDER_DISABLED=1`: disable auto-launch

Example (PowerShell):

```powershell
$env:QD_AUDIO_FORWARDER_PATH = "C:\\tools\\qd-audio-forwarder.exe"
$env:QD_AUDIO_CODEC = "opus"
npm start
```