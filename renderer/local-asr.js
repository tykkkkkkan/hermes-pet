/* 本地中文 ASR：运行脚本随包提供，模型和 WASM 首次启动下载到用户目录。 */
(function initLocalAsr() {
  const SAMPLE_RATE = 16000;
  const MODEL_BASE = 'petasset://asr-model/';
  const RUNTIME_BASE = 'petasset://asr-runtime/';
  let recognizer;
  let vad;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function loadScript(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${RUNTIME_BASE}${file}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`本地语音运行时加载失败：${file}`));
      document.head.appendChild(script);
    });
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

  function decodeSegments() {
    const texts = [];
    while (!vad.isEmpty()) {
      const segment = vad.front();
      vad.pop();
      const stream = recognizer.createStream();
      stream.acceptWaveform(SAMPLE_RATE, segment.samples);
      recognizer.decode(stream);
      const text = String(recognizer.getResult(stream)?.text || '').trim();
      stream.free();
      if (text) texts.push(text);
    }
    return texts;
  }

  class LocalRecognition {
    constructor() {
      this.lang = 'zh-CN';
      this.continuous = false;
      this.interimResults = true;
      this.running = false;
      this.audioContext = null;
      this.stream = null;
      this.source = null;
      this.processor = null;
      this.sink = null;
    }

    async start() {
      if (this.running) return;
      this.running = true;
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
          vad.acceptWaveform(downsample(event.inputBuffer.getChannelData(0), this.audioContext.sampleRate));
          for (const text of decodeSegments()) this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] });
        };
        this.source.connect(this.processor);
        this.processor.connect(this.sink);
        this.sink.connect(this.audioContext.destination);
        this.onstart?.();
        this.onaudiostart?.();
      } catch (error) {
        this.running = false;
        this.onerror?.({ error: error.message.includes('权限') ? 'not-allowed' : 'engine', message: error.message });
        this.cleanup();
        this.onend?.();
      }
    }

    stop() {
      if (!this.running) return;
      try {
        vad.flush();
        for (const text of decodeSegments()) this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] });
      } catch { /* 结束时没有完整语音段就忽略尾帧 */ }
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

  async function recognizePcm(samples, sampleRate = SAMPLE_RATE) {
    await ready;
    vad.reset();
    const input = downsample(samples, sampleRate);
    const texts = [];
    for (let offset = 0; offset < input.length; offset += 4096) {
      vad.acceptWaveform(input.slice(offset, offset + 4096));
      texts.push(...decodeSegments());
    }
    vad.flush();
    texts.push(...decodeSegments());
    return texts;
  }

  window.Module = { locateFile: (file) => `${MODEL_BASE}${file}` };
  window.petLocalAsr = { Recognition: LocalRecognition, ready, recognizePcm };

  window.pet.ensureAsrModel()
    .then(() => loadScript('sherpa-onnx-asr.js'))
    .then(() => loadScript('sherpa-onnx-vad.js'))
    .then(() => new Promise((resolve, reject) => {
      window.Module.onRuntimeInitialized = () => {
        try {
          vad = createVad(window.Module, {
            sampleRate: SAMPLE_RATE,
            sileroVad: {
              model: './silero_vad.onnx', threshold: 0.5,
              minSilenceDuration: 0.5, minSpeechDuration: 0.25,
              maxSpeechDuration: 20, windowSize: 512
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
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      const script = document.createElement('script');
      script.src = `${RUNTIME_BASE}sherpa-onnx-wasm-main-vad-asr.js`;
      script.onerror = () => reject(new Error('本地语音 WASM 加载失败'));
      document.head.appendChild(script);
    }))
    .then(resolveReady)
    .catch(rejectReady);
})();
