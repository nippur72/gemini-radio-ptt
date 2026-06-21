import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  onPttPressed: (callback: () => void) => {
    ipcRenderer.on('ptt-pressed', () => callback());
  },
  onPttReleased: (callback: () => void) => {
    ipcRenderer.on('ptt-released', () => callback());
  },
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('config-update', (_event, config) => callback(config));
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
  getEnv: () => ipcRenderer.invoke('get-env'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
