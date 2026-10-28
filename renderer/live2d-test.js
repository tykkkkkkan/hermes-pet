/* Phase 0：Live2D 渲染链路验证。分步诊断，定位到底卡在哪一环。 */

const BASE = 'petasset://app/assets/live2d/Hiyori/';
const MODEL_URL = `${BASE}Hiyori.model3.json`;

const logEl = document.getElementById('log');
const lines = [];

function log(message, kind = '') {
  lines.push({ message, kind });
  logEl.innerHTML = lines
    .map((item) => `<span class="${item.kind}">${item.message}</span>`)
    .join('\n');
  console.log(message);
}

function errText(err) {
  if (!err) return String(err);
  return err.message || err.toString();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Core 是 Emscripten/wasm，加载后要等运行时就绪，否则 Moc.fromArrayBuffer 会返回空 */
async function waitCoreReady(timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const core = window.Live2DCubismCore;
    if (core && core.Moc && typeof core.Moc.fromArrayBuffer === 'function') {
      try {
        if (core.Version && typeof core.Version.csmGetVersion === 'function') {
          const version = core.Version.csmGetVersion();
          if (version) return { ok: true, version };
        } else {
          return { ok: true, version: null };
        }
      } catch { /* 还没就绪，继续等 */ }
    }
    await sleep(120);
  }
  return { ok: false, version: null };
}

(async () => {
  try {
    log(`PIXI ${window.PIXI ? PIXI.VERSION : '未加载'}`, window.PIXI ? 'dim' : 'err');
    log(`Live2D 库 ${window.PIXI && PIXI.live2d ? '已加载' : '缺失'}`, window.PIXI && PIXI.live2d ? 'dim' : 'err');

    // --- Core API 探测 ---
    const core = window.Live2DCubismCore;
    if (!core) throw new Error('Live2DCubismCore 全局不存在');
    log(`Core 暴露的 API：${Object.keys(core).slice(0, 14).join(', ') || '（空）'}`, 'dim');
    log(`  Moc=${!!core.Moc} Version=${!!core.Version} Model=${!!core.Model}`, 'dim');

    const ready = await waitCoreReady();
    log(`Core 就绪：${ready.ok ? '是' : '否（超时）'}`, ready.ok ? 'ok' : 'err');
    if (ready.version != null) {
      const hex = (ready.version >>> 0).toString(16).padStart(8, '0');
      log(`  csmGetVersion=0x${hex}`, 'dim');
    }
    if (core.Version && typeof core.Version.csmGetLatestMocVersion === 'function') {
      log(`  csmGetLatestMocVersion=${core.Version.csmGetLatestMocVersion()}`, 'dim');
    }

    // --- 步骤 1：fetch model3.json ---
    const jsonRes = await fetch(MODEL_URL);
    log(`① model3.json HTTP ${jsonRes.status}`, jsonRes.ok ? 'ok' : 'err');
    const modelJson = await jsonRes.json();

    // --- 步骤 2：fetch moc3 ---
    const mocPath = `${BASE}${modelJson.FileReferences.Moc}`;
    const mocRes = await fetch(mocPath);
    log(`② moc3 HTTP ${mocRes.status}`, mocRes.ok ? 'ok' : 'err');
    const mocBuf = await mocRes.arrayBuffer();
    log(`   moc3 字节数 ${mocBuf.byteLength}`, 'dim');

    // --- 步骤 3：Core 解析 moc3 ---
    let mocOk = false;
    try {
      const moc = core.Moc.fromArrayBuffer(mocBuf);
      mocOk = !!moc;
      log(`③ Core 解析 moc3 ${mocOk ? '成功' : '返回空'}`, mocOk ? 'ok' : 'err');
    } catch (err) {
      log(`③ Core 解析 moc3 抛错：${errText(err)}`, 'err');
    }

    if (!mocOk) throw new Error('Core 无法解析 moc3，后续渲染跳过');

    // --- 步骤 4：真正建 PIXI 应用并加载模型 ---
    const app = new PIXI.Application({
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: window
    });
    document.getElementById('stage').appendChild(app.view);

    const model = await PIXI.live2d.Live2DModel.from(MODEL_URL, { autoInteract: false });
    app.stage.addChild(model);

    const fit = () => {
      const scale = Math.min(
        (window.innerWidth * 0.62) / model.width,
        (window.innerHeight * 0.94) / model.height
      );
      model.scale.set(scale);
      // 角色偏右，左边留给调试日志
      model.x = window.innerWidth * 0.66 - (model.width * scale) / 2;
      model.y = (window.innerHeight - model.height * scale) / 2;
    };
    fit();
    window.addEventListener('resize', fit);

    log(`④ 模型加载成功 ${Math.round(model.width)}×${Math.round(model.height)}`, 'ok');

    model.motion('Idle');
    log('⑤ Idle 动作已触发', 'ok');

    window.addEventListener('pointermove', (event) => {
      model.focus(event.clientX, event.clientY);
    });

    app.view.addEventListener('pointerdown', () => {
      model.motion('TapBody');
      log('⑥ TapBody 已触发', 'ok');
    });

    log('✓ 自检通过，正在渲染', 'ok');
  } catch (err) {
    log(`✗ 中断：${errText(err)}`, 'err');
    if (err && err.stack) console.error(err.stack);
  }
})();
