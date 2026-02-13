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
        let clientId = `client-${Date.now()}-${Math.floor(Math.random()*10000)}`;
        const remoteAddr = req.socket.remoteAddress;

        console.log(`[QuokkaDispatcher] New WebSocket connection from ${remoteAddr}`);

        // Set up ping/pong for keep-alive
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        clients.set(clientId, { ws, dispatcherSource: null });
        emit('qd:clientConnected', clientId);
        console.log(`[QuokkaDispatcher] Client connected: ${clientId}`);
        ws.send(JSON.stringify({ type: 'WS_SESSION', data: { wsClientId: clientId } }));

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch (e) {
                ws.send(JSON.stringify({ type: 'ERROR', data: { code: 'INVALID_JSON', message: 'Invalid JSON' } }));
                return;
            }
            // Forward all messages to Lua
            emit('qd:fromClient', clientId, msg.type, msg.data || {});
        });

        ws.on('close', () => {
            console.log(`[QuokkaDispatcher] Client disconnected: ${clientId}`);
            emit('qd:clientDisconnected', clientId);
            clients.delete(clientId);
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
