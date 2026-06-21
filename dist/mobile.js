"use strict";
(() => {
    // Hardcoded configurations for Mobile Demo
    const MODEL = 'gemini-3.1-flash-live-preview';
    const VOICE = 'Charon';
    const SYSTEM_INSTRUCTION = `Sei un operatore radio del Comando di Polizia Locale Vigili Urbani di Reggio Calabria.
Nome in codice "Volante 1" agente Cacciapuoti Vincenzo detto Cecè.
Comunica solo in italiano, stile walkie-talkie.
Rivolgiti all'utente come 'centrale', che è la centrale operativa situata al Comando Polizia di Viale aldo moro.
Tono che incarna lo stereotipo del vigile urbano ottuso e nullafacente.
Accento dialetto del sud di Reggio Calabria. Comunicazioni brevi, ridotte al necessario.
La volante è stazionata nei pressi del Corso Garibaldi di Palazzo San Giorgio, di Via Marina e del palazzo CEDIR.
La volante ha fatto un sacco di multe per divieto di sosta.`;
    // Instantiate the shared RadioApp
    const radio = new window.RadioApp();
    const pttBtn = document.getElementById('ptt-btn');
    const statusLed = document.getElementById('status-led');
    const statusText = document.getElementById('status-text');
    const glowRing = document.getElementById('glow-ring');
    // Helper to update segment lights on retro LED meters
    function updateLedMeter(meterId, percent) {
        const meter = document.getElementById(meterId);
        if (!meter)
            return;
        const segments = meter.querySelectorAll('.led-segment');
        const litCount = Math.round((percent / 100) * segments.length);
        segments.forEach((seg, idx) => {
            if (idx < litCount) {
                seg.classList.add('lit');
            }
            else {
                seg.classList.remove('lit');
            }
        });
    }
    // Bind state changes to the UI updater
    radio.onStateChange = () => {
        updateUI();
    };
    // Bind volume level changes to the UI LED meters (TX and RX)
    radio.onVolumeChange = (percent) => {
        updateLedMeter('tx-led-meter', percent);
    };
    radio.onRxVolumeChange = (percent) => {
        updateLedMeter('rx-led-meter', percent);
    };
    // Update UI states for mobile interface
    function updateUI() {
        if (!statusLed || !statusText || !glowRing || !pttBtn)
            return;
        // Clear previous states
        statusLed.className = 'led';
        glowRing.className = '';
        const root = document.documentElement;
        // Enable/Disable PTT button based on websocket connection
        if (radio.ws && radio.ws.readyState === WebSocket.OPEN) {
            pttBtn.disabled = false;
        }
        else {
            pttBtn.disabled = true;
        }
        if (radio.hasError) {
            statusLed.classList.add('led-error');
            statusText.textContent = radio.errorMessage;
            glowRing.classList.add('ring-error');
            root.style.setProperty('--theme-color', 'var(--color-err)');
            root.style.setProperty('--theme-rgb', 'var(--color-err-rgb)');
        }
        else if (radio.isRecording) {
            statusLed.classList.add('led-recording');
            statusText.textContent = 'TX (TRASMISSIONE)';
            glowRing.classList.add('ring-recording');
            root.style.setProperty('--theme-color', 'var(--color-tx)');
            root.style.setProperty('--theme-rgb', 'var(--color-tx-rgb)');
        }
        else if (radio.isPlaying) {
            statusLed.classList.add('led-speaking');
            statusText.textContent = 'RX (RICEZIONE)';
            glowRing.classList.add('ring-speaking');
            root.style.setProperty('--theme-color', 'var(--color-rx)');
            root.style.setProperty('--theme-rgb', 'var(--color-rx-rgb)');
        }
        else {
            statusLed.classList.add('led-idle');
            if (radio.ws && radio.ws.readyState === WebSocket.OPEN) {
                statusText.textContent = 'IDLE / PRONTO';
            }
            else {
                statusText.textContent = 'CONNESSIONE...';
            }
            glowRing.classList.add('ring-idle');
            root.style.setProperty('--theme-color', 'var(--color-idle)');
            root.style.setProperty('--theme-rgb', 'var(--color-idle-rgb)');
        }
    }
    // PTT Hybrid Control State
    let pressStartTime = 0;
    let isToggleActive = false;
    let isPointerDown = false;
    function handlePressStart(e) {
        e.preventDefault();
        if (radio.hasError)
            return;
        if (isPointerDown)
            return;
        isPointerDown = true;
        // Unlock AudioContext on mobile browser
        radio.initAudio();
        if (isToggleActive) {
            isToggleActive = false;
            radio.stopRecording();
            pttBtn.classList.remove('active');
            console.log('PTT Hybrid (Toggle Mode): Stopped transmission.');
            isPointerDown = false;
            return;
        }
        pressStartTime = Date.now();
        radio.startRecording();
        pttBtn.classList.add('active');
        console.log('PTT Hybrid: Started transmission.');
    }
    function handlePressEnd(e) {
        e.preventDefault();
        if (!isPointerDown)
            return;
        isPointerDown = false;
        if (radio.hasError)
            return;
        const pressDuration = Date.now() - pressStartTime;
        if (pressDuration < 350) {
            // Short click/touch: enter Toggle-to-Talk mode
            isToggleActive = true;
            console.log('PTT Hybrid: Entered Toggle mode (waiting for next tap to stop).');
        }
        else {
            // Long press: stop recording immediately on release (Hold-to-Talk)
            isToggleActive = false;
            radio.stopRecording();
            pttBtn.classList.remove('active');
            console.log('PTT Hybrid: Released Hold-to-Talk.');
        }
    }
    function handlePointerCancelOrLeave(e) {
        if (!isPointerDown)
            return;
        isPointerDown = false;
        if (!isToggleActive && radio.isRecording) {
            radio.stopRecording();
            pttBtn.classList.remove('active');
            console.log('PTT Hybrid: Pointer left/cancelled, stopped Hold-to-Talk.');
        }
    }
    // Register Unified Pointer Events
    pttBtn.addEventListener('pointerdown', handlePressStart);
    pttBtn.addEventListener('pointerup', handlePressEnd);
    pttBtn.addEventListener('pointercancel', handlePointerCancelOrLeave);
    pttBtn.addEventListener('pointerleave', handlePointerCancelOrLeave);
    // Main initialization
    async function main() {
        const params = new URLSearchParams(window.location.search);
        const apiKey = params.get('apiKey');
        const errorScreen = document.getElementById('error-screen');
        const radioScreen = document.getElementById('radio-screen');
        if (!apiKey) {
            errorScreen?.classList.remove('hidden');
            radioScreen?.classList.add('hidden');
            console.warn('API Key missing. Please provide ?apiKey=YOUR_KEY in the URL.');
        }
        else {
            errorScreen?.classList.add('hidden');
            radioScreen?.classList.remove('hidden');
            // Connect to the WebSocket using query string apiKey and fallback configs
            await radio.initWebSocket(apiKey, MODEL, VOICE, SYSTEM_INSTRUCTION);
        }
    }
    main();
})();
