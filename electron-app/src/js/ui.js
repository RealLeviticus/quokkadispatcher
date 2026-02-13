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
        try {
            if (this.incomingCallSound && this.incomingCallSound.paused) {
                this.incomingCallSound.currentTime = 0;
                this.incomingCallSound.play().catch(e => {
                    console.warn('Could not play incoming call sound:', e);
                });
            }
        } catch (e) {
            console.warn('Error playing sound:', e);
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
    }
}

// Create global UI manager instance
const ui = new UIManager();
