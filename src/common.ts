// Downsample float32 audio to 16kHz Int16 PCM
function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Int16Array {
  if (outputSampleRate > inputSampleRate) {
    throw new Error('Downsampling only supported');
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Int16Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }

    let val = accum / count;
    val = Math.max(-1, Math.min(1, val));
    result[offsetResult] = val < 0 ? val * 0x8000 : val * 0x7FFF;

    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper to generate soft-clipping curve for WaveShaperNode
function makeDistortionCurve(amount: number): Float32Array {
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

class RadioApp {
  public ws: WebSocket | null = null;
  public audioCtx: AudioContext | null = null;
  public micStream: MediaStream | null = null;
  public micProcessor: ScriptProcessorNode | null = null;
  public micSource: MediaStreamAudioSourceNode | null = null;

  public isRecording = false;
  public isPlaying = false;
  public geminiDoneSpeaking = false;
  public hasError = false;
  public errorMessage = 'ERR';

  // DSP elements
  public distortionNode: WaveShaperNode | null = null;
  public bandpassNode: BiquadFilterNode | null = null;
  public compressorNode: DynamicsCompressorNode | null = null;
  public noiseNode: AudioBufferSourceNode | null = null;
  public noiseGainNode: GainNode | null = null;
  public micLoopbackGainNode: GainNode | null = null;
  public rxAnalyser: AnalyserNode | null = null;
  private activeSources: AudioBufferSourceNode[] = [];

  // Playback queue tracking
  public nextPlaybackTime = 0;
  public playbackMonitorInterval: any = null;

  // Compile-time configs
  public FALLBACK_FILTER_MIN_FREQ = 300;
  public FALLBACK_FILTER_MAX_FREQ = 3000;
  public DISTORTION_AMOUNT = 3.5;
  public COMPRESSOR_THRESHOLD = -30;
  public COMPRESSOR_RATIO = 10;

  // Active DSP settings
  public dspConfig = {
    bandpassEnabled: false,
    whiteNoiseEnabled: false,
    squelchTailEnabled: false,
    rogerBeepEnabled: false,
    micLoopbackEnabled: false,
    filterMinFreq: 300,
    filterMaxFreq: 3000,
  };

  private wsConfig: { apiKey: string; model: string; voice: string; systemInstruction: string } | null = null;
  private micStreamInitialized = false;

  // UI callbacks
  public onStateChange: () => void = () => {};
  public onVolumeChange: (percent: number) => void = () => {};
  public onRxVolumeChange: (percent: number) => void = () => {};

  constructor() {}

  // Initialize Audio Context and DSP Nodes
  public async initAudio() {
    if (this.audioCtx) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    // Create Distortion Node (WaveShaper)
    this.distortionNode = this.audioCtx.createWaveShaper();
    this.distortionNode.curve = makeDistortionCurve(this.DISTORTION_AMOUNT) as any;
    this.distortionNode.oversample = '4x';

    // Create Bandpass filter
    this.bandpassNode = this.audioCtx.createBiquadFilter();
    this.bandpassNode.type = 'bandpass';
    const minFreq = this.dspConfig.filterMinFreq ?? this.FALLBACK_FILTER_MIN_FREQ;
    const maxFreq = this.dspConfig.filterMaxFreq ?? this.FALLBACK_FILTER_MAX_FREQ;
    const centerFrequency = Math.sqrt(minFreq * maxFreq);
    this.bandpassNode.frequency.setValueAtTime(centerFrequency, this.audioCtx.currentTime);
    this.bandpassNode.Q.setValueAtTime(5.0, this.audioCtx.currentTime);

    // Create Dynamics Compressor Node
    this.compressorNode = this.audioCtx.createDynamicsCompressor();
    this.compressorNode.threshold.setValueAtTime(this.COMPRESSOR_THRESHOLD, this.audioCtx.currentTime);
    this.compressorNode.knee.setValueAtTime(15, this.audioCtx.currentTime);
    this.compressorNode.ratio.setValueAtTime(this.COMPRESSOR_RATIO, this.audioCtx.currentTime);
    this.compressorNode.attack.setValueAtTime(0.005, this.audioCtx.currentTime);
    this.compressorNode.release.setValueAtTime(0.05, this.audioCtx.currentTime);

    this.rxAnalyser = this.audioCtx.createAnalyser();
    this.rxAnalyser.fftSize = 256;

    // Chain: distortionNode -> bandpassNode -> compressorNode -> rxAnalyser -> destination
    this.distortionNode.connect(this.bandpassNode);
    this.bandpassNode.connect(this.compressorNode);
    this.compressorNode.connect(this.rxAnalyser);
    this.rxAnalyser.connect(this.audioCtx.destination);

    // Initialize white noise
    this.initWhiteNoise();
  }

  private initWhiteNoise() {
    if (!this.audioCtx) return;

    const sampleRate = this.audioCtx.sampleRate;
    const bufferSize = sampleRate * 2; // 2 seconds loop
    const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

    this.noiseGainNode = this.audioCtx.createGain();
    this.noiseGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);

    this.noiseNode.connect(this.noiseGainNode);
    this.connectToDestination(this.noiseGainNode);
    this.noiseNode.start(0);
  }

  public fadeNoise(targetVolume: number) {
    if (!this.audioCtx || !this.noiseGainNode) return;

    if (!this.dspConfig.whiteNoiseEnabled) {
      this.noiseGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
      return;
    }

    const currentVal = this.noiseGainNode.gain.value;
    if (Math.abs(currentVal - targetVolume) < 0.001) return;

    this.noiseGainNode.gain.setTargetAtTime(targetVolume, this.audioCtx.currentTime, 0.04);
  }

  public connectToDestination(source: AudioNode) {
    if (!this.audioCtx) return;

    if (this.dspConfig.bandpassEnabled && this.distortionNode) {
      source.connect(this.distortionNode);
    } else if (this.rxAnalyser) {
      source.connect(this.rxAnalyser);
    } else {
      source.connect(this.audioCtx.destination);
    }
  }

  // Play Roger Beep sequence
  public playRogerBeep(callback: () => void) {
    if (!this.audioCtx || !this.dspConfig.rogerBeepEnabled) {
      callback();
      return;
    }

    this.fadeNoise(0.02);

    let time = this.audioCtx.currentTime;
    const toneDuration = 0.05;
    const numTones = 5;

    for (let i = 0; i < numTones; i++) {
      const osc = this.audioCtx.createOscillator();
      const oscGain = this.audioCtx.createGain();

      osc.type = 'sine';
      const freq = 800 + Math.random() * 1000;
      osc.frequency.setValueAtTime(freq, time);

      oscGain.gain.setValueAtTime(0, time);
      oscGain.gain.linearRampToValueAtTime(0.12, time + 0.005);
      oscGain.gain.setValueAtTime(0.12, time + toneDuration - 0.005);
      oscGain.gain.linearRampToValueAtTime(0, time + toneDuration);

      osc.connect(oscGain);
      if (this.rxAnalyser) {
        oscGain.connect(this.rxAnalyser);
      } else {
        oscGain.connect(this.audioCtx.destination);
      }

      osc.start(time);
      osc.stop(time + toneDuration);

      time += toneDuration;
    }

    setTimeout(callback, numTones * toneDuration * 1000);
  }

  // Play Squelch Tail
  public playSquelchTail() {
    if (!this.audioCtx || !this.dspConfig.squelchTailEnabled) return;

    const sampleRate = this.audioCtx.sampleRate;
    const duration = 0.25;
    const bufferSize = sampleRate * duration;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.audioCtx.createBufferSource();
    noiseSource.buffer = buffer;

    const decayGain = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;

    decayGain.gain.setValueAtTime(0.18, now);
    decayGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(decayGain);
    this.connectToDestination(decayGain);

    noiseSource.start(now);
    noiseSource.stop(now + duration + 0.05);
  }

  public triggerEndOfTurnEffects() {
    this.geminiDoneSpeaking = false;
    this.playRogerBeep(() => {
      this.fadeNoise(0);
      this.playSquelchTail();
    });
  }

  public startPlaybackMonitoring() {
    if (this.playbackMonitorInterval) return;

    this.playbackMonitorInterval = setInterval(() => {
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const isAudioPlaying = this.nextPlaybackTime > now;

      // Real-time calculation of RX volume from incoming audio
      let rxVolumePercent = 0;
      if (this.rxAnalyser && isAudioPlaying) {
        const bufferLength = this.rxAnalyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        this.rxAnalyser.getFloatTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        rxVolumePercent = Math.min(100, Math.round((rms / 0.25) * 100));
      }

      this.onRxVolumeChange(rxVolumePercent);

      if (this.isPlaying !== isAudioPlaying) {
        this.isPlaying = isAudioPlaying;
        this.onStateChange();

        if (!this.isPlaying) {
          if (this.geminiDoneSpeaking) {
            this.triggerEndOfTurnEffects();
          } else {
            this.fadeNoise(0);
          }
        } else {
          this.fadeNoise(0.025);
        }
      }
    }, 30);
  }

  // Initialize Gemini Live WebSocket
  public async initWebSocket(apiKey: string, model: string, voice: string, systemInstruction: string) {
    this.wsConfig = { apiKey, model, voice, systemInstruction };

    try {
      if (!apiKey || apiKey === 'your_gemini_api_key_here') {
        console.warn('API Key missing or set to placeholder.');
        this.hasError = true;
        this.errorMessage = 'NO KEY';
        this.onStateChange();
        return;
      }

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.hasError = false;
        this.onStateChange();

        const setupConfig: any = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice,
                  },
                },
              },
            },
            inputAudioTranscription: {},
            input_audio_transcription: {},
            outputAudioTranscription: {},
            output_audio_transcription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: true,
              },
            },
          },
        };

        if (systemInstruction) {
          setupConfig.setup.systemInstruction = {
            parts: [
              {
                text: systemInstruction,
              },
            ],
          };
        }

        this.ws?.send(JSON.stringify(setupConfig));
      };

      this.ws.onmessage = async (event) => {
        try {
          let text = '';
          if (event.data instanceof Blob) {
            text = await event.data.text();
          } else {
            text = event.data;
          }

          const response = JSON.parse(text);

          const topInputTx = response.inputTranscription || response.input_transcription;
          if (topInputTx && topInputTx.text) {
            console.log('>>> [USER TRANSCRIPT]:', topInputTx.text);
          }
          const topOutputTx = response.outputTranscription || response.output_transcription;
          if (topOutputTx && topOutputTx.text) {
            console.log('>>> [AI TRANSCRIPT]:', topOutputTx.text);
          }

          if (response.serverContent) {
            const inputTx = response.serverContent.inputTranscription || response.serverContent.input_transcription;
            if (inputTx && inputTx.text) {
              console.log('>>> [USER TRANSCRIPT]:', inputTx.text);
            }
            const outputTx = response.serverContent.outputTranscription || response.serverContent.output_transcription;
            if (outputTx && outputTx.text) {
              console.log('>>> [AI TRANSCRIPT]:', outputTx.text);
            }

            const modelTurn = response.serverContent.modelTurn;
            if (modelTurn && modelTurn.parts) {
              for (const part of modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  // If we are currently transmitting, ignore incoming speaker chunks
                  if (this.isRecording) {
                    console.log('>>> [RADIO COMMON]: Ignored incoming audio chunk because user is transmitting (PTT active).');
                    continue;
                  }

                  await this.initAudio();
                  if (!this.audioCtx) continue;

                  const base64Data = part.inlineData.data;
                  const arrayBuf = base64ToArrayBuffer(base64Data);
                  const rawPcm = new Int16Array(arrayBuf);
                  const floatPcm = new Float32Array(rawPcm.length);

                  for (let i = 0; i < rawPcm.length; i++) {
                    floatPcm[i] = rawPcm[i] / 32768.0;
                  }

                  const audioBuffer = this.audioCtx.createBuffer(1, floatPcm.length, 24000);
                  audioBuffer.getChannelData(0).set(floatPcm);

                  const sourceNode = this.audioCtx.createBufferSource();
                  sourceNode.buffer = audioBuffer;

                  this.connectToDestination(sourceNode);

                  // Keep track of active audio source
                  this.activeSources.push(sourceNode);
                  sourceNode.onended = () => {
                    this.activeSources = this.activeSources.filter(s => s !== sourceNode);
                  };

                  const now = this.audioCtx.currentTime;
                  if (this.nextPlaybackTime < now) {
                    this.nextPlaybackTime = now;
                  }

                  sourceNode.start(this.nextPlaybackTime);
                  this.nextPlaybackTime += audioBuffer.duration;

                  this.startPlaybackMonitoring();
                }
              }
            }

            if (response.serverContent.turnComplete === true) {
              this.geminiDoneSpeaking = true;
            }
          }
        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.warn('Gemini Live WebSocket closed:', event.reason);
        this.hasError = true;
        this.errorMessage = 'DISCONN';
        this.onStateChange();
        
        setTimeout(() => {
          if (this.wsConfig) {
            this.initWebSocket(
              this.wsConfig.apiKey,
              this.wsConfig.model,
              this.wsConfig.voice,
              this.wsConfig.systemInstruction
            );
          }
        }, 4000);
      };

      this.ws.onerror = (err) => {
        console.error('Gemini Live WebSocket error:', err);
        this.hasError = true;
        this.errorMessage = 'CONN ERR';
        this.onStateChange();
      };
    } catch (err) {
      console.error('Error configuring Gemini Live WebSocket:', err);
      this.hasError = true;
      this.errorMessage = 'SYS ERR';
      this.onStateChange();
    }
  }

  public async initMicStream() {
    if (this.micStreamInitialized) return;

    try {
      await this.initAudio();
      if (!this.audioCtx) return;

      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
      this.micProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);

      this.micProcessor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const inputBuffer = e.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputBuffer.length; i++) {
          sum += inputBuffer[i] * inputBuffer[i];
        }
        const rms = Math.sqrt(sum / inputBuffer.length);
        const volumePercent = Math.min(100, Math.round((rms / 0.25) * 100));

        this.onVolumeChange(volumePercent);

        const pttBuffer = downsampleBuffer(inputBuffer, this.audioCtx!.sampleRate, 16000);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const base64Data = arrayBufferToBase64(pttBuffer.buffer);
          this.ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: base64Data,
                },
              },
            })
          );
        }
      };

      this.micLoopbackGainNode = this.audioCtx.createGain();
      this.micLoopbackGainNode.gain.setValueAtTime(
        this.dspConfig.micLoopbackEnabled ? 1.0 : 0.0,
        this.audioCtx.currentTime
      );

      this.micSource.connect(this.micLoopbackGainNode);
      this.micLoopbackGainNode.connect(this.audioCtx.destination);

      this.micSource.connect(this.micProcessor);
      this.micProcessor.connect(this.audioCtx.destination);

      this.micStreamInitialized = true;
    } catch (err) {
      console.error('Error initializing microphone stream:', err);
      this.hasError = true;
      this.errorMessage = 'MIC ERR';
      this.onStateChange();
    }
  }

  public stopAllPlayback() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore already stopped
      }
    });
    this.activeSources = [];
    this.nextPlaybackTime = 0;
    this.isPlaying = false;
    this.geminiDoneSpeaking = false;
    this.fadeNoise(0);
    this.onStateChange();
    this.onRxVolumeChange(0);
  }

  public async startRecording() {
    if (this.isRecording) return;

    // Interrupt any active speaking immediately when PTT is pressed
    this.stopAllPlayback();

    await this.initMicStream();
    if (this.hasError) return;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.isRecording = true;
    this.geminiDoneSpeaking = false;
    this.onStateChange();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            activityStart: {},
          },
        })
      );
    }
  }

  public stopRecording() {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.onStateChange();
    this.onVolumeChange(0);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            activityEnd: {},
          },
        })
      );
    }
  }
}

// Expose RadioApp globally
(window as any).RadioApp = RadioApp;
