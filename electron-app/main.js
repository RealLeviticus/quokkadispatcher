const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

let mainWindow;
let voiceRelay = null;
let forwarderProcess = null;

const VOICE_RELAY_PORT = 30130;
const CONSUMER_PATH = '/voice-relay';
const INGEST_PATH = '/voice-relay/ingest';
const INGEST_ENDPOINT = `ws://127.0.0.1:${VOICE_RELAY_PORT}${INGEST_PATH}`;

function splitArgs(value) {
    if (!value) return [];
    const parts = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if ((ch === '"' || ch === "'")) {
            if (!quote) {
                quote = ch;
            } else if (quote === ch) {
                quote = null;
            } else {
                current += ch;
            }
            continue;
        }

        if (!quote && /\s/.test(ch)) {
            if (current.length > 0) {
                parts.push(current);
                current = '';
            }
            continue;
        }

        current += ch;
    }

    if (current.length > 0) {
        parts.push(current);
    }

    return parts;
}

function getDefaultForwarderName() {
    if (process.platform === 'win32') return 'qd-audio-forwarder.exe';
    if (process.platform === 'darwin') return 'qd-audio-forwarder-macos';
    return 'qd-audio-forwarder-linux';
}

function resolveBundledForwarderPath() {
    const binaryName = getDefaultForwarderName();
    const candidates = [];

    if (app.isPackaged) {
        candidates.push(path.join(process.resourcesPath, 'bin', binaryName));
    }

    candidates.push(path.join(__dirname, 'bin', binaryName));
    candidates.push(path.join(__dirname, '..', 'native-audio-bridge', 'bin', binaryName));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getForwarderLaunchConfig() {
    if (process.env.QD_AUDIO_FORWARDER_DISABLED === '1') {
        return null;
    }

    const envPath = process.env.QD_AUDIO_FORWARDER_PATH;
    const forwarderPath = envPath && fs.existsSync(envPath) ? envPath : resolveBundledForwarderPath();
    if (!forwarderPath) {
        console.warn('[QuokkaDispatcher] Audio forwarder binary not found. Voice forwarding is disabled.');
        console.warn('[QuokkaDispatcher] Place binary at electron-app/bin or set QD_AUDIO_FORWARDER_PATH.');
        return null;
    }

    const codec = (process.env.QD_AUDIO_CODEC || 'pcm16').toLowerCase();
    const source = process.env.QD_AUDIO_SOURCE || '1';
    const defaultArgs = [
        '--endpoint', INGEST_ENDPOINT,
        '--codec', codec,
        '--source', source,
    ];
    const extraArgs = splitArgs(process.env.QD_AUDIO_FORWARDER_ARGS || '');

    return {
        command: forwarderPath,
        args: [...defaultArgs, ...extraArgs],
    };
}

function startAudioForwarder() {
    if (forwarderProcess) return;

    const launch = getForwarderLaunchConfig();
    if (!launch) return;

    forwarderProcess = spawn(launch.command, launch.args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    forwarderProcess.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[AudioForwarder] ${text}`);
    });

    forwarderProcess.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[AudioForwarder] ${text}`);
    });

    forwarderProcess.on('error', (err) => {
        console.error(`[QuokkaDispatcher] Failed to start audio forwarder: ${err.message}`);
        forwarderProcess = null;
    });

    forwarderProcess.on('exit', (code, signal) => {
        console.log(`[QuokkaDispatcher] Audio forwarder exited (code=${code}, signal=${signal})`);
        forwarderProcess = null;
    });

    console.log(`[QuokkaDispatcher] Audio forwarder started: ${launch.command} ${launch.args.join(' ')}`);
}

function stopAudioForwarder() {
    if (!forwarderProcess) return;
    try {
        forwarderProcess.kill();
    } catch {}
    forwarderProcess = null;
}

function startVoiceRelayServer() {
    if (voiceRelay) return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };

        const wss = new WebSocketServer({
            host: '127.0.0.1',
            port: VOICE_RELAY_PORT,
        });

        const consumers = new Set();
        const producers = new Set();

        const removeSocket = (ws) => {
            consumers.delete(ws);
            producers.delete(ws);
        };

        wss.on('connection', (ws, req) => {
            const parsedUrl = new URL(req.url || '/', `ws://${req.headers.host || `127.0.0.1:${VOICE_RELAY_PORT}`}`);
            const pathName = parsedUrl.pathname;

            if (pathName === CONSUMER_PATH) {
                consumers.add(ws);
                ws.role = 'consumer';
                ws.send(JSON.stringify({ type: 'VOICE_RELAY_READY', data: { port: VOICE_RELAY_PORT } }));
            } else if (pathName === INGEST_PATH) {
                producers.add(ws);
                ws.role = 'producer';
            } else {
                ws.close(1008, 'Unknown relay path');
                return;
            }

            ws.on('message', (data, isBinary) => {
                if (ws.role !== 'producer') {
                    return;
                }

                if (isBinary) {
                    for (const consumer of consumers) {
                        if (consumer.readyState === 1) {
                            consumer.send(data, { binary: true });
                        }
                    }
                    return;
                }

                // Pass through text metadata (JSON) from producer to consumers.
                const text = data.toString();
                for (const consumer of consumers) {
                    if (consumer.readyState === 1) {
                        consumer.send(text);
                    }
                }
            });

            ws.on('close', () => removeSocket(ws));
            ws.on('error', () => removeSocket(ws));
        });

        wss.on('listening', () => {
            console.log(`[QuokkaDispatcher] Voice relay listening on ws://127.0.0.1:${VOICE_RELAY_PORT}`);
            console.log(`[QuokkaDispatcher] Producer endpoint: ws://127.0.0.1:${VOICE_RELAY_PORT}${INGEST_PATH}`);
            console.log(`[QuokkaDispatcher] Consumer endpoint: ws://127.0.0.1:${VOICE_RELAY_PORT}${CONSUMER_PATH}`);
            finish();
        });

        wss.on('error', (err) => {
            console.error(`[QuokkaDispatcher] Voice relay error: ${err.message}`);
            finish();
        });

        voiceRelay = {
            wss,
            close: () => {
                for (const ws of consumers) {
                    try { ws.close(); } catch {}
                }
                for (const ws of producers) {
                    try { ws.close(); } catch {}
                }
                wss.close();
            },
        };
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 900,
        minHeight: 600,
        title: 'QuokkaDispatcher',
        backgroundColor: '#1a1a2e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // Remove default menu bar
    mainWindow.setMenuBarVisibility(false);

    // Open DevTools automatically for debugging
    mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
    await startVoiceRelayServer();
    startAudioForwarder();
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', () => {
    if (voiceRelay) {
        voiceRelay.close();
        voiceRelay = null;
    }
    stopAudioForwarder();
});
