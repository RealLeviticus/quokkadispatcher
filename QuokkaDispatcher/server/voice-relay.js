const WebSocket = require('ws');

const VOICE_WS_PORT = GetConvarInt('qd_voice_ws_port', 30130);
const DISPATCHER_PATH = '/voice/dispatcher';
const INGEST_PATH = '/voice/ingest';

const ROUTE_MAGIC = 'QDRT';
const ROUTE_HEADER_SIZE = 10;

let voiceWss = null;

/** @type {Map<string, { radioChannel: number, callChannel: number }>} */
const dispatcherContexts = new Map();

/** @type {Set<WebSocket>} */
const consumers = new Set();
/** @type {Set<WebSocket>} */
const producers = new Set();

function parseQueryValue(rawUrl, key) {
    const qPos = rawUrl.indexOf('?');
    if (qPos === -1) return null;
    const query = rawUrl.slice(qPos + 1);
    for (const entry of query.split('&')) {
        const [k, v] = entry.split('=');
        if (k === key) return decodeURIComponent(v || '');
    }
    return null;
}

function parseRouteFrame(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < ROUTE_HEADER_SIZE) return null;

    const magic = buffer.toString('ascii', 0, 4);
    if (magic !== ROUTE_MAGIC) return null;

    const version = buffer.readUInt8(4);
    if (version !== 1) return null;

    const sourceType = buffer.readUInt8(5); // 1=radio, 2=call
    const routeId = buffer.readUInt16LE(6); // radio channel or call channel
    const payloadLen = buffer.readUInt16LE(8);
    if (ROUTE_HEADER_SIZE + payloadLen > buffer.length) return null;

    const payload = buffer.subarray(ROUTE_HEADER_SIZE, ROUTE_HEADER_SIZE + payloadLen);
    return { sourceType, routeId, payload };
}

function shouldReceive(ws, sourceType, routeId) {
    const wsClientId = ws.wsClientId;
    if (!wsClientId) return true;

    const ctx = dispatcherContexts.get(wsClientId);
    if (!ctx) return false;

    if (sourceType === 1) {
        return ctx.radioChannel > 0 && ctx.radioChannel === routeId;
    }

    if (sourceType === 2) {
        return ctx.callChannel > 0 && ctx.callChannel === routeId;
    }

    return false;
}

function updateDispatcherContext(wsClientId, context) {
    if (!wsClientId) return;

    const prev = dispatcherContexts.get(wsClientId) || { radioChannel: 0, callChannel: 0 };

    const next = {
        radioChannel: typeof context.radioChannel === 'number' ? context.radioChannel : prev.radioChannel,
        callChannel: typeof context.callChannel === 'number' ? context.callChannel : prev.callChannel,
    };

    dispatcherContexts.set(wsClientId, next);
}

function clearDispatcherContext(wsClientId) {
    if (!wsClientId) return;
    dispatcherContexts.delete(wsClientId);
}

function removeSocket(ws) {
    consumers.delete(ws);
    producers.delete(ws);
}

function routeProducerBinaryFrame(rawBuffer) {
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
    const routeFrame = parseRouteFrame(buffer);

    if (!routeFrame) {
        // Fallback for legacy producers sending QDAV directly: broadcast to all dispatchers.
        for (const consumer of consumers) {
            if (consumer.readyState === WebSocket.OPEN) {
                consumer.send(buffer, { binary: true });
            }
        }
        return;
    }

    for (const consumer of consumers) {
        if (consumer.readyState !== WebSocket.OPEN) continue;
        if (shouldReceive(consumer, routeFrame.sourceType, routeFrame.routeId)) {
            consumer.send(routeFrame.payload, { binary: true });
        }
    }
}

function routeRoutedPayload(sourceType, routeId, payloadBuffer) {
    if (!Buffer.isBuffer(payloadBuffer)) return;

    for (const consumer of consumers) {
        if (consumer.readyState !== WebSocket.OPEN) continue;
        if (shouldReceive(consumer, sourceType, routeId)) {
            consumer.send(payloadBuffer, { binary: true });
        }
    }
}

function startVoiceRelay() {
    voiceWss = new WebSocket.Server({ port: VOICE_WS_PORT });

    voiceWss.on('listening', () => {
        console.log(`[QuokkaDispatcher] Voice relay listening on ws://0.0.0.0:${VOICE_WS_PORT}`);
        console.log(`[QuokkaDispatcher] Voice relay consumer path: ${DISPATCHER_PATH}`);
        console.log(`[QuokkaDispatcher] Voice relay ingest path: ${INGEST_PATH}`);
    });

    voiceWss.on('error', (err) => {
        console.error(`[QuokkaDispatcher] Voice relay error: ${err.message}`);
    });

    voiceWss.on('connection', (ws, req) => {
        const rawUrl = req.url || '/';
        const pathName = rawUrl.split('?')[0];

        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        if (pathName === DISPATCHER_PATH) {
            ws.role = 'consumer';
            ws.wsClientId = parseQueryValue(rawUrl, 'wsClientId') || null;
            consumers.add(ws);
            ws.send(
                JSON.stringify({
                    type: 'VOICE_RELAY_READY',
                    data: {
                        port: VOICE_WS_PORT,
                        path: DISPATCHER_PATH,
                        wsClientId: ws.wsClientId,
                    },
                })
            );
        } else if (pathName === INGEST_PATH) {
            ws.role = 'producer';
            producers.add(ws);
        } else {
            ws.close(1008, 'Unknown voice relay path');
            return;
        }

        ws.on('message', (data, isBinary) => {
            if (ws.role === 'producer') {
                if (isBinary) {
                    routeProducerBinaryFrame(data);
                    return;
                }

                const text = data.toString();
                for (const consumer of consumers) {
                    if (consumer.readyState === WebSocket.OPEN) {
                        consumer.send(text);
                    }
                }
                return;
            }

            // Allow dispatcher clients to send metadata to producers.
            if (!isBinary) {
                const text = data.toString();
                for (const producer of producers) {
                    if (producer.readyState === WebSocket.OPEN) {
                        producer.send(text);
                    }
                }
            }
        });

        ws.on('close', () => removeSocket(ws));
        ws.on('error', () => removeSocket(ws));
    });

    setInterval(() => {
        if (!voiceWss) return;
        voiceWss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                try {
                    ws.terminate();
                } catch {}
                return;
            }
            ws.isAlive = false;
            try {
                ws.ping();
            } catch {}
        });
    }, 30000);
}

on('qd:voice:setDispatcherContext', (wsClientId, context) => {
    try {
        updateDispatcherContext(wsClientId, context || {});
    } catch (err) {
        console.error(`[QuokkaDispatcher] Failed to set voice context: ${err.message}`);
    }
});

on('qd:voice:clearDispatcherContext', (wsClientId) => {
    clearDispatcherContext(wsClientId);
});

// Optional server-side ingest entrypoint for pma-voice forks or other resources.
// payloadB64 should be a base64 encoded QDAV packet.
on('qd:voice:ingestRoutedPayload', (sourceType, routeId, payloadB64) => {
    try {
        const src = Number(sourceType) || 0;
        const route = Number(routeId) || 0;
        if ((src !== 1 && src !== 2) || route <= 0 || typeof payloadB64 !== 'string' || payloadB64.length === 0) {
            return;
        }

        const payload = Buffer.from(payloadB64, 'base64');
        if (!payload || payload.length === 0) return;
        routeRoutedPayload(src, route, payload);
    } catch (err) {
        console.error(`[QuokkaDispatcher] ingestRoutedPayload failed: ${err.message}`);
    }
});

startVoiceRelay();
