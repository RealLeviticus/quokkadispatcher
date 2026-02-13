/**
 * UI State Management for QuokkaDispatcher
 * Handles all DOM updates and visual state changes
 */

class UIManager {
    constructor() {
        this.activeCall = null;
        this.currentChannel = 0;
        this.isPTTActive = false;
        this.incomingCalls = new Map();
        this.currentPlayers = new Map();
        this.callTimers = new Map();
        this.initializeElements();

        // PTT Key
        this.pttKeyInput = document.getElementById('pttKeyInput');
        this.pttKeyDisplay = document.getElementById('pttKeyDisplay');
        this.pttKey = localStorage.getItem('qd_pttKey') || ' '; // Default: spacebar
        this.updatePTTKeyDisplay();

        // Listen for key input
        if (this.pttKeyInput) {
            this.pttKeyInput.value = this.pttKey;
            this.pttKeyInput.addEventListener('keydown', (e) => {
                e.preventDefault();
                let key = e.key.length === 1 ? e.key : (e.code === 'Space' ? ' ' : '');
                if (key) {
                    this.pttKey = key;
                    this.pttKeyInput.value = key;
                    localStorage.setItem('qd_pttKey', key);
                    this.updatePTTKeyDisplay();
                }
            });
        }
    }

    initializeElements() {
        // Connection elements
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.statusMessage = document.getElementById('statusMessage');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.connectionText = document.getElementById('connectionText');

        // Radio elements
        this.channelInput = document.getElementById('channelInput');
        this.joinChannelBtn = document.getElementById('joinChannelBtn');
        this.leaveChannelBtn = document.getElementById('leaveChannelBtn');
        this.currentChannelSpan = document.getElementById('currentChannel');
        this.radioPlayersList = document.getElementById('radioPlayersList');
        this.pttBtn = document.getElementById('pttBtn');
        this.pttIndicator = document.getElementById('pttIndicator');

        // Call elements
        this.incomingCallsList = document.getElementById('incomingCallsList');
        this.callCount = document.getElementById('callCount');
        this.activeCallView = document.getElementById('activeCallView');
        this.activeCallerName = document.getElementById('activeCallerName');
        this.activeCallerSource = document.getElementById('activeCallerSource');
        this.callDuration = document.getElementById('callDuration');
        this.muteBtn = document.getElementById('muteBtn');
        this.endCallBtn = document.getElementById('endCallBtn');
        this.closeCallViewBtn = document.getElementById('closeCallViewBtn');

        // Server URL input removed; server URL is now hard-coded in logic

        // Audio
        this.incomingCallSound = document.getElementById('incomingCallSound');
        this.micClickOnSound = document.getElementById('micClickOnSound');
        this.micClickOffSound = document.getElementById('micClickOffSound');
    }

    playMicClickOn() {
        try {
            if (this.micClickOnSound) {
                this.micClickOnSound.currentTime = 0;
                this.micClickOnSound.play().catch(() => {});
            }
        } catch {}
    }

    playMicClickOff() {
        try {
            if (this.micClickOffSound) {
                this.micClickOffSound.currentTime = 0;
                this.micClickOffSound.play().catch(() => {});
            }
        } catch {}
    }

    updatePTTKeyDisplay() {
        if (this.pttKeyDisplay) {
            let label = this.pttKey === ' ' ? 'Spacebar' : this.pttKey.toUpperCase();
            this.pttKeyDisplay.textContent = `Current: ${label}`;
        }
    }

    /**
     * Show a status message
     */
    showStatus(message, type = 'info') {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message visible ${type}`;
        
        if (type !== 'error') {
            setTimeout(() => {
                this.statusMessage.classList.remove('visible');
            }, 4000);
        }
    }

    /**
     * Update connection status
     */
    setConnectionStatus(connected) {
        if (connected) {
            this.connectionStatus.className = 'status-indicator connected';
            this.connectionText.textContent = 'Connected';
            this.connectBtn.disabled = true;
            this.disconnectBtn.disabled = false;
            this.channelInput.disabled = false;
            this.joinChannelBtn.disabled = false;
            this.pttBtn.disabled = false;
        } else {
            this.connectionStatus.className = 'status-indicator disconnected';
            this.connectionText.textContent = 'Disconnected';
            this.connectBtn.disabled = false;
            this.disconnectBtn.disabled = true;
            this.channelInput.disabled = true;
            this.joinChannelBtn.disabled = true;
            this.leaveChannelBtn.disabled = true;
            this.pttBtn.disabled = true;
            this.currentChannel = 0;
            this.updateCurrentChannel();
        }
    }

    /**
     * Get connection configuration from inputs
     */
    getConnectionConfig() {
        return {
            serverUrl: 'ws://103.203.241.35:30125',
        };
    }

    /**
     * Update current radio channel display
     */
    updateCurrentChannel() {
        if (this.currentChannel === 0) {
            this.currentChannelSpan.textContent = 'None';
            this.leaveChannelBtn.disabled = true;
        } else {
            this.currentChannelSpan.textContent = this.currentChannel;
            this.leaveChannelBtn.disabled = false;
        }
    }

    /**
     * Update list of players on current radio channel
     */
    updateRadioPlayers(players) {
        this.currentPlayers.clear();

        if (!players || players.length === 0) {
            this.radioPlayersList.innerHTML = '<p class="empty-message">No players on channel</p>';
            return;
        }

        players.forEach(player => {
            this.currentPlayers.set(player.source, player);
        });

        const html = players.map(player => `
            <div class="player-item ${player.isTalking ? 'talking' : ''}">
                <span class="player-name">${this.escapeHtml(player.name)}</span>
                <span class="player-source">ID: ${player.source}</span>
                ${player.isTalking ? '<div class="talking-indicator"></div>' : ''}
            </div>
        `).join('');

        this.radioPlayersList.innerHTML = html;
    }

    /**
     * Add incoming call to the list
     */
    addIncomingCall(callId, callerName, callerSource) {
        this.incomingCalls.set(callId, {
            id: callId,
            callerName,
            callerSource,
            receivedAt: new Date(),
        });

        this.updateIncomingCallsList();
        this.playIncomingCallSound();
    }

    /**
     * Remove call from incoming list
     */
    removeIncomingCall(callId) {
        this.incomingCalls.delete(callId);
        this.updateIncomingCallsList();
        // Stop ringtone if no more incoming calls
        if (this.incomingCalls.size === 0) {
            this.stopIncomingCallSound();
        }
    }

    /**
     * Update incoming calls list display
     */
    updateIncomingCallsList() {
        this.callCount.textContent = this.incomingCalls.size;

        if (this.incomingCalls.size === 0) {
            this.incomingCallsList.innerHTML = '<div class="empty-message">No incoming calls</div>';
            return;
        }

        const html = Array.from(this.incomingCalls.values()).map(call => `
            <div class="call-card" data-call-id="${call.id}">
                <div class="call-card-header">
                    <span class="call-card-name">${this.escapeHtml(call.callerName)}</span>
                    <span class="call-card-time">${this.getTimeString(call.receivedAt)}</span>
                </div>
                <div class="call-card-details">Source: ${call.callerSource}</div>
                <div class="call-card-actions">
                    <button class="btn btn-primary call-answer-btn" data-call-id="${call.id}">Answer</button>
                    <button class="btn btn-danger call-reject-btn" data-call-id="${call.id}">Reject</button>
                </div>
            </div>
        `).join('');

        this.incomingCallsList.innerHTML = html;

        // Attach event listeners
        this.incomingCallsList.querySelectorAll('.call-answer-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const callId = parseInt(btn.dataset.callId);
                window.dispatcherApp?.answerCall(callId);
            });
        });

        this.incomingCallsList.querySelectorAll('.call-reject-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const callId = parseInt(btn.dataset.callId);
                window.dispatcherApp?.rejectCall(callId);
            });
        });
    }

    /**
     * Show active call view
     */
    showActiveCall(callId, callerName, callerSource) {
        this.activeCall = { callId, callerName, callerSource, startTime: Date.now() };
        this.activeCallerName.textContent = this.escapeHtml(callerName);
        this.activeCallerSource.textContent = callerSource;
        this.activeCallView.classList.remove('hidden');

        // Start duration timer
        this.startCallDurationTimer(callId);

        // Remove from incoming calls
        this.removeIncomingCall(callId);

        // Stop ringtone immediately when call is picked up
        this.stopIncomingCallSound();
    }

    /**
     * Hide active call view
     */
    hideActiveCall() {
        if (this.activeCall) {
            const callId = this.activeCall.callId;
            this.stopCallDurationTimer(callId);
            this.activeCall = null;
        }
        this.activeCallView.classList.add('hidden');
    }

    /**
     * Start timer for call duration
     */
    startCallDurationTimer(callId) {
        this.stopCallDurationTimer(callId); // Clear existing timer

        const timer = setInterval(() => {
            if (!this.activeCall || this.activeCall.callId !== callId) {
                clearInterval(timer);
                return;
            }

            const elapsed = Date.now() - this.activeCall.startTime;
            const seconds = Math.floor(elapsed / 1000);
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;

            this.callDuration.textContent = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }, 100);

        this.callTimers.set(callId, timer);
    }

    /**
     * Stop call duration timer
     */
    stopCallDurationTimer(callId) {
        const timer = this.callTimers.get(callId);
        if (timer) {
            clearInterval(timer);
            this.callTimers.delete(callId);
        }
    }

    /**
     * Update PTT (Push-to-Talk) state
     */
    setPTTActive(active) {
        this.isPTTActive = active;
        if (active) {
            this.pttIndicator.classList.add('active');
        } else {
            this.pttIndicator.classList.remove('active');
        }
    }

    /**
     * Set mute state
     */
    setMuted(muted) {
        if (muted) {
            this.muteBtn.dataset.muted = 'true';
            this.muteBtn.querySelector('.mute-text').textContent = 'Muted';
            this.muteBtn.classList.add('muted');
        } else {
            this.muteBtn.dataset.muted = 'false';
            this.muteBtn.querySelector('.mute-text').textContent = 'Unmuted';
            this.muteBtn.classList.remove('muted');
        }
    }

    /**
     * Play incoming call sound (once)
     */
    playIncomingCallSound() {
        // If already playing/looping, do nothing
        if (this._incomingCallLoopTimer) return;
        if (!this.incomingCallSound) return;

        this.incomingCallSound.currentTime = 0;
        this.incomingCallSound.loop = true;
        this.incomingCallSound.play().catch(() => {});

        // Stop after 15 seconds if not answered
        this._incomingCallLoopTimer = setTimeout(() => {
            this.stopIncomingCallSound();
        }, 15000);
    }

    stopIncomingCallSound() {
        if (this.incomingCallSound) {
            this.incomingCallSound.pause();
            this.incomingCallSound.currentTime = 0;
            this.incomingCallSound.loop = false;
        }
        if (this._incomingCallLoopTimer) {
            clearTimeout(this._incomingCallLoopTimer);
            this._incomingCallLoopTimer = null;
        }
    }

    /**
     * Utility: Get time string (e.g., "5 mins ago")
     */
    getTimeString(date) {
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);

        if (diff < 60) return 'just now';
        if (diff < 120) return '1 min ago';
        if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
        return date.toLocaleTimeString();
    }

    /**
     * Utility: Escape HTML characters
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Clear all call-related state
     */
    clearCallState() {
        this.incomingCalls.clear();
        this.currentPlayers.clear();
        this.callTimers.forEach(timer => clearInterval(timer));
        this.callTimers.clear();
        this.hideActiveCall();
        this.updateIncomingCallsList();
        this.updateRadioPlayers([]);
        this.stopIncomingCallSound();
    }

    /**
     * Voice relay: play incoming audio stream from server
     */
    setupVoiceRelay(voiceRelayUrl) {
        if (!voiceRelayUrl) return;
        if (!this.lastVoiceContext) this.lastVoiceContext = null;
        if (this.voiceSocket && this.voiceRelayUrl === voiceRelayUrl && this.voiceSocket.readyState === 1) return;
        this.disconnectVoiceRelay();
        this.voiceRelayUrl = voiceRelayUrl;

        this.voiceSocket = new WebSocket(voiceRelayUrl);
        this.voiceSocket.binaryType = 'arraybuffer';
        this.voiceRelayConnected = false;

        this.voiceSocket.onopen = () => {
            console.log('Voice relay WebSocket connected');
            this.voiceRelayConnected = true;
            if (this.lastVoiceContext) {
                this.sendVoiceControl('VOICE_CONTEXT', this.lastVoiceContext);
            }
        };
        this.voiceSocket.onclose = () => {
            console.log('Voice relay WebSocket disconnected');
            this.voiceRelayConnected = false;
        };
        this.voiceSocket.onerror = (e) => {
            console.warn('Voice relay WebSocket error:', e);
        };
        this.voiceSocket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'VOICE_RELAY_READY') {
                        console.log('Voice relay ready:', msg.data);
                    }
                } catch {}
                return;
            }

            this.playIncomingAudio(event.data);
        };
    }

    disconnectVoiceRelay() {
        if (this.voiceSocket) {
            try {
                this.voiceSocket.close();
            } catch {}
            this.voiceSocket = null;
        }
        this.voiceRelayUrl = null;
        this.voiceRelayConnected = false;
    }

    sendVoiceControl(type, data) {
        if (!this.voiceSocket || this.voiceSocket.readyState !== 1) return;
        try {
            this.voiceSocket.send(JSON.stringify({ type, data }));
        } catch {}
    }

    updateVoiceContext(context) {
        this.lastVoiceContext = context;
        if (this.voiceRelayConnected) {
            this.sendVoiceControl('VOICE_CONTEXT', context);
        }
    }

    playIncomingAudio(arrayBuffer) {
        // Quokka packet framing:
        // magic(4) version(1) source(1) codec(1) channels(1) sampleRate(u16) payloadLen(u16) seq(u32) timestampMs(u64)
        const packet = this.parseVoicePacket(arrayBuffer);
        if (!packet) return;

        // Opus payload forwarding is supported at transport level but decoder hookup is pending.
        if (packet.codec !== 2) return;

        const audioCtx = this._audioCtx || (this._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
        const pcm = new Int16Array(packet.payload);
        const frameCount = Math.floor(pcm.length / packet.channels);
        if (frameCount <= 0) return;

        const buffer = audioCtx.createBuffer(packet.channels, frameCount, packet.sampleRate);
        for (let ch = 0; ch < packet.channels; ch++) {
            const channelData = buffer.getChannelData(ch);
            for (let frame = 0; frame < frameCount; frame++) {
                const sampleIndex = frame * packet.channels + ch;
                channelData[frame] = pcm[sampleIndex] / 32768;
            }
        }
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(audioCtx.destination);
        src.start();
    }

    parseVoicePacket(arrayBuffer) {
        if (!(arrayBuffer instanceof ArrayBuffer)) return null;
        if (arrayBuffer.byteLength < 24) return null;

        const view = new DataView(arrayBuffer);
        const magic =
            String.fromCharCode(view.getUint8(0)) +
            String.fromCharCode(view.getUint8(1)) +
            String.fromCharCode(view.getUint8(2)) +
            String.fromCharCode(view.getUint8(3));

        if (magic !== 'QDAV') return null;

        const version = view.getUint8(4);
        if (version !== 1) return null;

        const codec = view.getUint8(6); // 1=Opus, 2=PCM16LE
        const channels = view.getUint8(7);
        const sampleRate = view.getUint16(8, true);
        const payloadLen = view.getUint16(10, true);
        const payloadOffset = 24;

        if (payloadOffset + payloadLen > arrayBuffer.byteLength) return null;
        const payload = arrayBuffer.slice(payloadOffset, payloadOffset + payloadLen);

        return { codec, channels, sampleRate, payload };
    }
}

// Create global UI manager instance
const ui = new UIManager();
