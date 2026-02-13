const { contextBridge } = require('electron');

// Expose a minimal API to the renderer.
// The renderer uses the browser-native WebSocket API directly,
// so no Node.js modules are needed in the renderer process.
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
});
