/* Electron 内置的离线中文 ASR：麦克风采样、VAD 和识别都在本机完成。 */
(function initLocalAsr() {
  const SAMPLE_RATE = 16000;
  let resolveReady;
  let rejectReady;
  let recognizer;
  let vad;
  let runtimeError;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const oldRuntimeReady = window.Module?.onRuntimeInitialized;
  if (window.Module) {
    window.Module.onRuntimeInitialized = () => {
      try {
        if (typeof oldRuntimeReady === 'function') oldRuntimeReady();
        vad = createVad(window.Module, {
          sampleRate: SAMPLE_RATE,
          sileroVad: {
            model: './silero_vad.onnx',
            threshold: 0.5,
            minSilenceDuration: 0.5,
            minSpeechDuration: 0.25,
            maxSpeechDuration: 20,
            windowSize: 512
          }
        });
        recognizer = new OfflineRecognizer({
          modelConfig: {
            tokens: './tokens.txt',
            transducer: {
              encoder: './transducer-encoder.onnx',
              decoder: './transducer-decoder.onnx',
              joiner: './transducer-joiner.onnx'
            },
            modelType: 'transducer'
          },
          decodingMethod: 'greedy_search'
        }, window.Module);
        resolveReady();
      } catch (error) {
        runtimeError = error;
        rejectReady(error);
      }
    };
  } else {
    runtimeError = new Error('本地语音引擎未加载');
    rejectReady(runtimeError);
  }

  function downsample(samples, inputRate) {
    if (inputRate === SAMPLE_RATE) return samples;
    const ratio = inputRate / SAMPLE_RATE;
    const result = new Float32Array(Math.round(samples.length / ratio));
    for (let i = 0; i < result.length; i++) {
      const start = Math.round(i * ratio);
      const end = Math.min(samples.length, Math.round((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      result[i] = sum / Math.max(1, end - start);
    }
    return result;
  }

  class LocalRecognition {
    constructor() {
      this.lang = 'zh-CN';
      this.continuous = false;
      this.interimResults = true;
      this.running = false;
      this.stopping = false;
      this.audioContext = null;
      this.stream = null;
      this.source = null;
      this.processor = null;
      this.sink = null;
    }

    async start() {
      if (this.running) return;
      this.running = true;
      this.stopping = false;
      try {
        await ready;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        await this.audioContext.resume();
        this.source = this.audioContext.createMediaStreamSource(this.stream);
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.sink = this.audioContext.createGain();
        this.sink.gain.value = 0;
        vad.reset();
        this.processor.onaudioprocess = (event) => {
          if (!this.running) return;
          const input = event.inputBuffer.getChannelData(0);
          vad.acceptWaveform(downsample(input, this.audioContext.sampleRate));
          this.emitSegments();
        };
        this.source.connect(this.processor);
        this.processor.connect(this.sink);
        this.sink.connect(this.audioContext.destination);
        this.onstart?.();
        this.onaudiostart?.();
      } catch (error) {
        this.running = false;
        this.onerror?.({ error: runtimeError ? 'engine' : 'not-allowed', message: error.message });
        this.cleanup();
        this.onend?.();
      }
    }

    emitSegments() {
      while (!vad.isEmpty()) {
        const segment = vad.front();
        vad.pop();
        const stream = recognizer.createStream();
        stream.acceptWaveform(SAMPLE_RATE, segment.samples);
        recognizer.decode(stream);
        const text = String(recognizer.getResult(stream)?.text || '').trim();
        stream.free();
        if (text) this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] });
      }
    }

    stop() {
      if (!this.running) return;
      this.stopping = true;
      try {
        vad.flush();
        this.emitSegments();
      } catch { /* 引擎正在结束时忽略尾部空帧 */ }
      this.running = false;
      this.cleanup();
      this.onaudioend?.();
      this.onspeechend?.();
      this.onend?.();
    }

    cleanup() {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.audioContext?.close().catch(() => {});
      this.processor = null;
      this.source = null;
      this.sink = null;
      this.stream = null;
      this.audioContext = null;
    }
  }

  window.petLocalAsr = { Recognition: LocalRecognition, ready };
})();
