/**
 * Main Application Logic for QuokkaDispatcher Electron App
 * Handles WebSocket communication, radio control, and call management
 */

class DispatcherApp {
    constructor() {
        this.wsClient = null;
        this.dispatcherLinked = false;
        this.pttPressed = false;
        this.channelJoined = false;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Connection buttons
        ui.connectBtn.addEventListener('click', () => this.connect());
        ui.disconnectBtn.addEventListener('click', () => this.disconnect());

        // Radio controls
        ui.joinChannelBtn.addEventListener('click', () => this.joinChannel());
        ui.leaveChannelBtn.addEventListener('click', () => this.leaveChannel());
        ui.channelInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinChannel();
        });

        // PTT (Push-to-Talk)
        ui.pttBtn.addEventListener('mousedown', () => this.startPTT());
        ui.pttBtn.addEventListener('mouseup', () => this.stopPTT());
        ui.pttBtn.addEventListener('mouseleave', () => {
            if (this.pttPressed) this.stopPTT();
        });

        // Touch support for PTT on mobile
        ui.pttBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startPTT();
        });
        ui.pttBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopPTT();
        });

        // Call actions
        ui.muteBtn.addEventListener('click', () => this.toggleMute());
        ui.endCallBtn.addEventListener('click', () => this.endCall());
        ui.closeCallViewBtn.addEventListener('click', () => {
            ui.hideActiveCall();
        });
    }

    /**
     * Connect to FiveM server WebSocket
     */
    connect() {
        const config = ui.getConnectionConfig();
        if (!config.serverUrl) {
            ui.showStatus('Server URL is required', 'error');
            return;
        }
        ui.showStatus('Connecting...', 'info');
        this.wsClient = new DispatcherWSClient(config.serverUrl);
        // Message handlers
        this.wsClient.on('_connectionStateChanged', (data) => {
            if (data.connected) {
                ui.showStatus('Connected to server', 'success');
                ui.setConnectionStatus(true);
            } else {
                ui.showStatus('Disconnected from server', 'error');
                ui.setConnectionStatus(false);
                this.dispatcherLinked = false;
            }
        });
        this.wsClient.on('INCOMING_CALL', (data) => {
            this.handleIncomingCall(data);
        });
        this.wsClient.on('CALL_ANSWERED', (data) => {
            this.handleCallAnswered(data);
        });
        this.wsClient.on('CALL_ENDED', (data) => {
            this.handleCallEnded(data);
        });
        this.wsClient.on('RADIO_JOINED', (data) => {
            this.channelJoined = true;
            ui.currentChannel = data.channel;
            ui.updateCurrentChannel();
            ui.showStatus(`Joined radio channel ${data.channel}`, 'success');
            console.log('Joined channel:', data.channel);
        });
        this.wsClient.on('RADIO_LEFT', (data) => {
            this.channelJoined = false;
            ui.currentChannel = 0;
            ui.updateCurrentChannel();
            ui.updateRadioPlayers([]);
            ui.showStatus(`Left radio channel ${data.channel}`, 'info');
        });
        this.wsClient.on('RADIO_STATE', (data) => {
            if (ui.currentChannel === data.channel) {
                ui.updateRadioPlayers(data.players);
            }
        });
        this.wsClient.on('ERROR', (data) => {
            ui.showStatus(`Error: ${data.message || data.code}`, 'error');
            console.error('Server error:', data);
        });
        this.wsClient.on('PONG', (data) => {
            // Keep-alive response, ignore
        });
        // Connect to server
        this.wsClient.connect();
    }

    /**
     * Disconnect from FiveM server
     */
    disconnect() {
        if (this.wsClient) {
            this.wsClient.disconnect();
            this.wsClient = null;
        }
        this.dispatcherLinked = false;
        ui.setConnectionStatus(false);
        ui.clearCallState();
        ui.showStatus('Disconnected', 'info');
    }

    /**
     * Link this WebSocket client to a dispatcher player
     */
    linkDispatcher(license) {
        if (!this.wsClient || !this.wsClient.authenticated) {
            ui.showStatus('Not authenticated yet', 'error');
            return;
        }

        this.wsClient.send('LINK_DISPATCHER', { license });
    }

    /**
     * Join a radio channel
     */
    joinChannel() {
        if (!this.dispatcherLinked) {
            ui.showStatus('Not linked to dispatcher', 'error');
            return;
        }

        const channel = parseInt(ui.channelInput.value);
        if (!channel || channel < 1 || channel > 500) {
            ui.showStatus('Channel must be between 1 and 500', 'error');
            return;
        }

        if (this.wsClient) {
            this.wsClient.send('JOIN_RADIO', { channel });
        }
    }

    /**
     * Leave current radio channel
     */
    leaveChannel() {
        if (!this.dispatcherLinked) {
            ui.showStatus('Not linked to dispatcher', 'error');
            return;
        }

        if (this.wsClient) {
            this.wsClient.send('LEAVE_RADIO', {});
        }
    }

    /**
     * Start PTT (Push-to-Talk)
     */
    startPTT() {
        if (!this.dispatcherLinked || ui.currentChannel === 0) {
            return;
        }

        this.pttPressed = true;
        ui.setPTTActive(true);

        if (this.wsClient) {
            this.wsClient.send('START_RADIO_TALK', {});
        }
    }

    /**
     * Stop PTT
     */
    stopPTT() {
        if (!this.pttPressed) return;

        this.pttPressed = false;
        ui.setPTTActive(false);

        if (this.wsClient) {
            this.wsClient.send('STOP_RADIO_TALK', {});
        }
    }

    /**
     * Handle incoming call
     */
    handleIncomingCall(data) {
        console.log('Incoming call:', data);
        ui.addIncomingCall(data.callId, data.callerName, data.callerSource);
    }

    /**
     * Answer incoming call
     */
    answerCall(callId) {
        if (!this.dispatcherLinked) {
            ui.showStatus('Not linked to dispatcher', 'error');
            return;
        }

        const call = ui.incomingCalls.get(callId);
        if (!call) {
            ui.showStatus('Call not found', 'error');
            return;
        }

        if (this.wsClient) {
            this.wsClient.send('ANSWER_CALL', { callId });
        }
    }

    /**
     * Handle call answered event
     */
    handleCallAnswered(data) {
        const call = ui.incomingCalls.get(data.callId);
        if (call) {
            ui.showActiveCall(data.callId, call.callerName, call.callerSource);
            ui.showStatus(`Call answered with ${call.callerName}`, 'success');
        }
    }

    /**
     * End/disconnect current call
     */
    endCall() {
        if (!this.dispatcherLinked || !ui.activeCall) {
            return;
        }

        if (this.wsClient) {
            this.wsClient.send('END_CALL', { callId: ui.activeCall.callId });
        }
    }

    /**
     * Reject incoming call
     */
    rejectCall(callId) {
        if (!this.dispatcherLinked) {
            ui.showStatus('Not linked to dispatcher', 'error');
            return;
        }

        if (this.wsClient) {
            this.wsClient.send('REJECT_CALL', { callId });
        }

        ui.removeIncomingCall(callId);
        ui.showStatus('Call rejected', 'info');
    }

    /**
     * Handle call ended event
     */
    handleCallEnded(data) {
        if (ui.activeCall && ui.activeCall.callId === data.callId) {
            ui.hideActiveCall();
            ui.showStatus('Call ended', 'info');
        }
        ui.removeIncomingCall(data.callId);
    }

    /**
     * Toggle mute state (placeholder)
     */
    toggleMute() {
        const currentMuted = ui.muteBtn.dataset.muted === 'true';
        ui.setMuted(!currentMuted);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('[QuokkaDispatcher] Initializing...');

    // Load saved settings from localStorage

    // Server URL is now hard-coded; no need to load or save

    // Create app instance
    window.dispatcherApp = new DispatcherApp();

    // Global PTT keydown/keyup
    let pttKeyDown = false;
    window.addEventListener('keydown', (e) => {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
        const key = e.key.length === 1 ? e.key : (e.code === 'Space' ? ' ' : '');
        if (!pttKeyDown && key && key.toLowerCase() === ui.pttKey.toLowerCase()) {
            pttKeyDown = true;
            window.dispatcherApp && window.dispatcherApp.startPTT();
        }
    });
    window.addEventListener('keyup', (e) => {
        const key = e.key.length === 1 ? e.key : (e.code === 'Space' ? ' ' : '');
        if (pttKeyDown && key && key.toLowerCase() === ui.pttKey.toLowerCase()) {
            pttKeyDown = false;
            window.dispatcherApp && window.dispatcherApp.stopPTT();
        }
    });

    console.log('[QuokkaDispatcher] Ready');
});
