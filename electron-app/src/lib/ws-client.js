/**
 * WebSocket client for communicating with the QuokkaDispatcher FiveM resource.
 * Handles authentication, reconnection, and message routing.
 */
class DispatcherWSClient {
    /**
     * @param {string} serverUrl - WebSocket URL (e.g., 'ws://127.0.0.1:30125')
     * @param {string} authToken - Auth token matching the FiveM resource config
     */
    constructor(serverUrl, authToken) {
        this.serverUrl = serverUrl;
        this.authToken = authToken;
        this.clientId = crypto.randomUUID();
        /** @type {WebSocket|null} */
        this.ws = null;
        /** @type {Map<string, Function[]>} */
        this.listeners = new Map();
        this.reconnectInterval = 5000;
        this.reconnectTimer = null;
        this.connected = false;
        this.authenticated = false;
        this.pingInterval = null;
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
            this.connected = true;
            this._dispatch('_connectionStateChanged', { connected: true });

            // Send authentication
            this._send({
                type: 'AUTH',
                token: this.authToken,
                clientId: this.clientId,
            });

            // Start ping keepalive
            this.pingInterval = setInterval(() => {
                this.send('PING', {});
            }, 25000);
        };

        this.ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            if (msg.type === 'AUTH_OK') {
                this.authenticated = true;
                this._dispatch('_authStateChanged', { authenticated: true });
            } else if (msg.type === 'AUTH_FAILED') {
                this.authenticated = false;
                this._dispatch('_authStateChanged', { authenticated: false, reason: msg.data?.reason });
                this.disconnect();
                return;
            }

            this._dispatch(msg.type, msg.data || {});
        };

        this.ws.onclose = () => {
            this._cleanup();
            this._dispatch('_connectionStateChanged', { connected: false });
            this._scheduleReconnect();
        };

        this.ws.onerror = () => {
            // onclose will fire after this
        };
    }

    disconnect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;

        if (this.ws) {
            this.ws.close();
        }
        this._cleanup();
    }

    /**
     * Send a typed message to the server.
     * @param {string} type
     * @param {object} data
     */
    send(type, data) {
        this._send({ type, data, clientId: this.clientId });
    }

    /**
     * Link this WebSocket session to a dispatcher's FiveM license.
     * @param {string} license - Full FiveM license identifier (e.g., 'license:abc123...')
     */
    linkDispatcher(license) {
        this.send('LINK_DISPATCHER', { license });
    }

    /**
     * Register a listener for a message type.
     * @param {string} type
     * @param {Function} callback
     */
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    /**
     * Remove a listener.
     * @param {string} type
     * @param {Function} callback
     */
    off(type, callback) {
        const handlers = this.listeners.get(type);
        if (handlers) {
            const idx = handlers.indexOf(callback);
            if (idx !== -1) handlers.splice(idx, 1);
        }
    }

    /** @private */
    _send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    /** @private */
    _dispatch(type, data) {
        const handlers = this.listeners.get(type) || [];
        for (const cb of handlers) {
            try {
                cb(data);
            } catch (err) {
                console.error(`[WS] Error in handler for ${type}:`, err);
            }
        }
    }

    /** @private */
    _cleanup() {
        this.connected = false;
        this.authenticated = false;
        clearInterval(this.pingInterval);
        this.pingInterval = null;
    }

    /** @private */
    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectInterval);
    }
}
