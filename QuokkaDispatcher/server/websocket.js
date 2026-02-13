const WebSocket = require('ws');

const WS_PORT = GetConvarInt('qd_ws_port', 30125);
const AUTH_TOKEN = GetConvar('qd_auth_token', 'CHANGE_ME_SECURE_RANDOM_TOKEN');

/** @type {Map<string, { ws: WebSocket, dispatcherSource: number|null }>} */
const clients = new Map();

let wss = null;

// ============================================================
// Start WebSocket server
// ============================================================

function startServer() {
    wss = new WebSocket.Server({ port: WS_PORT });

    wss.on('listening', () => {
        console.log(`[QuokkaDispatcher] WebSocket server listening on port ${WS_PORT}`);
    });

    wss.on('error', (err) => {
        console.error(`[QuokkaDispatcher] WebSocket server error: ${err.message}`);
    });

    wss.on('connection', (ws, req) => {
        let authenticated = false;
        let clientId = null;
        const remoteAddr = req.socket.remoteAddress;

        console.log(`[QuokkaDispatcher] New WebSocket connection from ${remoteAddr}`);

        // Set up ping/pong for keep-alive
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch (e) {
                ws.send(JSON.stringify({ type: 'ERROR', data: { code: 'INVALID_JSON', message: 'Invalid JSON' } }));
                return;
            }

            // First message must be AUTH
            if (!authenticated) {
                if (msg.type === 'AUTH' && msg.token === AUTH_TOKEN) {
                    authenticated = true;
                    clientId = msg.clientId || `client-${Date.now()}`;
                    clients.set(clientId, { ws, dispatcherSource: null });
                    ws.send(JSON.stringify({ type: 'AUTH_OK', data: {} }));
                    emit('qd:clientConnected', clientId);
                    console.log(`[QuokkaDispatcher] Client authenticated: ${clientId}`);
                } else {
                    ws.send(JSON.stringify({ type: 'AUTH_FAILED', data: { reason: 'Invalid token' } }));
                    ws.close();
                }
                return;
            }

            // Forward authenticated messages to Lua
            emit('qd:fromClient', clientId, msg.type, msg.data || {});
        });

        ws.on('close', () => {
            if (clientId) {
                console.log(`[QuokkaDispatcher] Client disconnected: ${clientId}`);
                emit('qd:clientDisconnected', clientId);
                clients.delete(clientId);
            }
        });

        ws.on('error', (err) => {
            console.error(`[QuokkaDispatcher] Client WebSocket error: ${err.message}`);
        });
    });

    // Heartbeat: ping all clients every 30s, terminate unresponsive ones
    setInterval(() => {
        if (!wss) return;
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
}

// ============================================================
// Event handlers: Lua -> WebSocket clients
// ============================================================

on('qd:ws:sendToClient', (clientId, msgType, data) => {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: msgType, data: data || {} }));
    }
});

on('qd:ws:broadcast', (msgType, data) => {
    const msg = JSON.stringify({ type: msgType, data: data || {} });
    for (const [, client] of clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(msg);
        }
    }
});

on('qd:ws:setDispatcherSource', (clientId, source) => {
    const client = clients.get(clientId);
    if (client) {
        client.dispatcherSource = source;
    }
});

// ============================================================
// Start
// ============================================================

startServer();
