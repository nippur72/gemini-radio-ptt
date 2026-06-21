"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
const node_global_key_listener_1 = require("node-global-key-listener");
// Load environment variables
dotenv.config();
let mainWindow = null;
let tray = null;
let keyboardListener = null;
// --- COMPILE-TIME CONFIGURATION ---
// You can manually adjust the bandpass filter frequency range (Hz) here:
const FILTER_MIN_FREQ = 300;
const FILTER_MAX_FREQ = 2500;
// ----------------------------------
// Initial state of DSP configuration
const dspConfig = {
    bandpassEnabled: false,
    whiteNoiseEnabled: false,
    squelchTailEnabled: false,
    rogerBeepEnabled: false,
    micLoopbackEnabled: false,
    filterMinFreq: FILTER_MIN_FREQ,
    filterMaxFreq: FILTER_MAX_FREQ,
};
// Global key states to track Scroll Lock
const pressedKeys = new Map();
let pttActive = false;
function isScrollLockDown() {
    return pressedKeys.get('SCROLL LOCK') === true || pressedKeys.get('SCROLL') === true;
}
function updatePTTState() {
    const activeNow = isScrollLockDown();
    if (activeNow !== pttActive) {
        pttActive = activeNow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (pttActive) {
                mainWindow.webContents.send('ptt-pressed');
            }
            else {
                mainWindow.webContents.send('ptt-released');
            }
        }
    }
}
function createWindow() {
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;
    const windowWidth = 90;
    const windowHeight = 90;
    const x = workX + workWidth - windowWidth - 20;
    const y = workY + workHeight - windowHeight - 20;
    mainWindow = new electron_1.BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: true, // required to capture mouse events/clicks
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
    // Open DevTools in detached mode to inspect logs
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
    // Ensure window is always on top even over full screen windows
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    // Prevent window from stealing focus on launch
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            mainWindow.showInactive();
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function createTray() {
    // Create a 16x16 pixel white solid native image as placeholder
    const buffer = Buffer.alloc(16 * 16 * 4, 255); // RGBA all white
    // Add some color to make it look like a little radio icon
    for (let i = 0; i < 16; i++) {
        // Draw a green border
        for (let j = 0; j < 16; j++) {
            if (i === 0 || i === 15 || j === 0 || j === 15) {
                const idx = (i * 16 + j) * 4;
                buffer[idx] = 46; // R
                buffer[idx + 1] = 204; // G
                buffer[idx + 2] = 113; // B
                buffer[idx + 3] = 255; // A
            }
        }
    }
    const icon = electron_1.nativeImage.createFromBuffer(buffer, { width: 16, height: 16 });
    tray = new electron_1.Tray(icon);
    tray.setToolTip('Gemini Radio PTT');
    updateTrayMenu();
}
function updateTrayMenu() {
    if (!tray)
        return;
    const contextMenu = electron_1.Menu.buildFromTemplate([
        { label: 'Gemini Radio PTT', enabled: false },
        { type: 'separator' },
        {
            label: `Bandpass Filter (${FILTER_MIN_FREQ}Hz-${FILTER_MAX_FREQ >= 1000 ? (FILTER_MAX_FREQ / 1000) + 'kHz' : FILTER_MAX_FREQ + 'Hz'})`,
            type: 'checkbox',
            checked: dspConfig.bandpassEnabled,
            click: (item) => {
                dspConfig.bandpassEnabled = item.checked;
                sendConfigToRenderer();
            },
        },
        {
            label: 'White Noise (5%)',
            type: 'checkbox',
            checked: dspConfig.whiteNoiseEnabled,
            click: (item) => {
                dspConfig.whiteNoiseEnabled = item.checked;
                sendConfigToRenderer();
            },
        },
        {
            label: 'Roger Beep (5-Tone Chirp)',
            type: 'checkbox',
            checked: dspConfig.rogerBeepEnabled,
            click: (item) => {
                dspConfig.rogerBeepEnabled = item.checked;
                sendConfigToRenderer();
            },
        },
        {
            label: 'Squelch Tail (Static Burst)',
            type: 'checkbox',
            checked: dspConfig.squelchTailEnabled,
            click: (item) => {
                dspConfig.squelchTailEnabled = item.checked;
                sendConfigToRenderer();
            },
        },
        {
            label: 'Microphone Loopback (Self-Test)',
            type: 'checkbox',
            checked: dspConfig.micLoopbackEnabled,
            click: (item) => {
                dspConfig.micLoopbackEnabled = item.checked;
                sendConfigToRenderer();
            },
        },
        { type: 'separator' },
        {
            label: 'Reload App',
            click: () => {
                if (mainWindow)
                    mainWindow.reload();
            },
        },
        {
            label: 'Quit',
            click: () => {
                electron_1.app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);
}
function sendConfigToRenderer() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config-update', dspConfig);
    }
}
// Setup IPC handlers
electron_1.ipcMain.handle('get-config', () => {
    return dspConfig;
});
electron_1.ipcMain.handle('get-env', () => {
    let systemInstruction = '';
    try {
        const promptPath = path.join(__dirname, '../system_instruction.txt');
        if (fs.existsSync(promptPath)) {
            systemInstruction = fs.readFileSync(promptPath, 'utf-8').trim();
        }
    }
    catch (err) {
        console.error('Failed to read system_instruction.txt:', err);
    }
    return {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
        voice: process.env.GEMINI_VOICE || 'Kore',
        systemInstruction,
    };
});
electron_1.ipcMain.on('close-window', () => {
    electron_1.app.quit();
});
// Setup global key hooks
function setupGlobalKeys() {
    try {
        keyboardListener = new node_global_key_listener_1.GlobalKeyboardListener();
        keyboardListener.addListener((e) => {
            if (e.name) {
                const isDown = e.state === 'DOWN';
                pressedKeys.set(e.name, isDown);
                updatePTTState();
            }
        });
        console.log('Global keyboard hook initialized successfully.');
    }
    catch (err) {
        console.error('Failed to initialize global keyboard listener:', err);
    }
}
electron_1.app.whenReady().then(() => {
    createWindow();
    createTray();
    setupGlobalKeys();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('will-quit', () => {
    // Clean up keyboard listener
    if (keyboardListener) {
        keyboardListener.kill();
    }
});
