interface Window {
  api: {
    onPttPressed: (callback: () => void) => void;
    onPttReleased: (callback: () => void) => void;
    onConfigUpdate: (callback: (config: any) => void) => void;
    getConfig: () => Promise<any>;
    getEnv: () => Promise<any>;
    closeWindow: () => void;
  };
  RadioApp: any;
}

(() => {
  // Instantiate the shared RadioApp
  const radio = new (window as any).RadioApp();

  // Bind state changes to the UI updater
  radio.onStateChange = () => {
    updateUI();
  };

  // Bind volume level changes to the UI volume bar
  radio.onVolumeChange = (percent: number) => {
    const volBar = document.getElementById('volume-bar');
    if (volBar) {
      volBar.style.width = `${percent}%`;
    }
  };

  // Update UI class states for desktop interface
  function updateUI() {
    const box = document.getElementById('state-box');
    const label = document.getElementById('status-label');
    if (!box || !label) return;

    box.className = '';

    if (radio.hasError) {
      box.classList.add('state-error');
      label.textContent = radio.errorMessage;
    } else if (radio.isRecording) {
      box.classList.add('state-recording');
      label.textContent = 'TX';
    } else if (radio.isPlaying) {
      box.classList.add('state-speaking');
      label.textContent = 'RX';
    } else {
      box.classList.add('state-idle');
      label.textContent = 'IDLE';
    }
  }

  // Event Listeners for Desktop UI
  document.getElementById('close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.closeWindow();
  });

  // Handle PTT IPC triggers from Electron Main process
  window.api.onPttPressed(() => {
    radio.startRecording();
  });

  window.api.onPttReleased(() => {
    radio.stopRecording();
  });

  // Handle config updates from main process tray menu
  window.api.onConfigUpdate((newConfig: any) => {
    console.log('DSP Config updated in renderer:', newConfig);
    const bandpassChanged =
      newConfig.bandpassEnabled !== undefined &&
      newConfig.bandpassEnabled !== radio.dspConfig.bandpassEnabled;

    radio.dspConfig = { ...radio.dspConfig, ...newConfig };

    // Update noise routing if bandpass setting is toggled
    if (bandpassChanged && radio.noiseGainNode) {
      radio.noiseGainNode.disconnect();
      radio.connectToDestination(radio.noiseGainNode);
    }

    // Update loopback gain dynamically
    if (radio.micLoopbackGainNode && radio.audioCtx) {
      radio.micLoopbackGainNode.gain.setValueAtTime(
        radio.dspConfig.micLoopbackEnabled ? 1.0 : 0.0,
        radio.audioCtx.currentTime
      );
    }

    // If noise is turned off mid-speech, stop it instantly
    if (!radio.dspConfig.whiteNoiseEnabled) {
      radio.fadeNoise(0);
    } else if (radio.isPlaying) {
      radio.fadeNoise(0.05);
    }
  });

  // Initialize on load
  async function main() {
    // Get initial DSP settings
    const config = await window.api.getConfig();
    radio.dspConfig = { ...radio.dspConfig, ...config };

    // Fetch env configuration from desktop main process
    const env = await window.api.getEnv();
    const { apiKey, model, voice, systemInstruction } = env;

    // Connect to WebSocket API
    await radio.initWebSocket(apiKey, model, voice, systemInstruction);
  }

  main();
})();
