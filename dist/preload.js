"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    onPttPressed: (callback) => {
        electron_1.ipcRenderer.on('ptt-pressed', () => callback());
    },
    onPttReleased: (callback) => {
        electron_1.ipcRenderer.on('ptt-released', () => callback());
    },
    onConfigUpdate: (callback) => {
        electron_1.ipcRenderer.on('config-update', (_event, config) => callback(config));
    },
    getConfig: () => electron_1.ipcRenderer.invoke('get-config'),
    getEnv: () => electron_1.ipcRenderer.invoke('get-env'),
    closeWindow: () => electron_1.ipcRenderer.send('close-window'),
});
