/* Live2D 渲染层：加载模型、驱动六态参数、接管四区互动反馈。
   任何一步失败都静默回退到静态立绘，不影响桌宠原有行为。 */
(function () {
  const MODEL_URL = 'petasset://app/assets/live2d/Hiyori/Hiyori.model3.json';
  const lerp = (a, b, t) => a + (b - a) * t;

  let app = null;
  let model = null;
  let core = null;
  let ready = false;
  let state = 'idle';
  let lookX = 0;
  let lookY = 0;
  let speakUntil = 0;
  let hopUntil = 0;

  /* 六态目标参数：角度 / 眼开度 / 嘴型 / 眉高 / 身体倾斜 / 呼吸强度 */
  const STATES = {
    idle: { angleX: 0, angleY: 0, eye: 1, mouth: 0, form: 0.2, brow: 0, body: 0, breath: 1 },
    thinking: { angleX: 5, angleY: 11, eye: 1, mouth: 0.04, form: 0.1, brow: 0.25, body: 1, breath: 1 },
    working: { angleX: -5, angleY: 5, eye: 0.92, mouth: 0, form: 0.15, brow: 0.15, body: -1, breath: 1.25 },
    success: { angleX: 0, angleY: -3, eye: 0.35, mouth: 0.55, form: 0.85, brow: 0.55, body: 0, breath: 1.1 },
    error: { angleX: 0, angleY: -9, eye: 0.55, mouth: 0.18, form: -0.7, brow: -0.65, body: 0, breath: 0.8 },
    sleep: { angleX: 0, angleY: -7, eye: 0, mouth: 0, form: -0.05, brow: -0.25, body: 0, breath: 0.7 }
  };

  const current = { ...STATES.idle };
  let target = { ...STATES.idle };

  function setParam(id, value) {
    if (!core || value == null || Number.isNaN(value)) return;
    try {
      core.setParameterValueById(id, value);
    } catch { /* 模型没有该参数就跳过 */ }
  }

  /* 每帧把参数向目标插值，再接视线/口型/跳跃的瞬时叠加 */
  function applyParams() {
    if (!ready) return;
    for (const key of Object.keys(STATES.idle)) {
      current[key] = lerp(current[key], target[key], 0.1);
    }
    const now = performance.now();
    const speaking = now < speakUntil;
    // 说话时嘴巴随正弦开合，不依赖 TTS，纯视觉节奏
    const mouth = speaking
      ? Math.max(0, Math.sin((now - (speakUntil - 1400)) / 95) * 0.35 + 0.32)
      : current.mouth;
    const jump = now < hopUntil ? Math.sin(((hopUntil - now) / 420) * Math.PI) * 6 : 0;

    setParam('ParamAngleX', current.angleX + lookX * 13);
    setParam('ParamAngleY', current.angleY + lookY * 9 - jump);
    setParam('ParamAngleZ', lookX * 4);
    setParam('ParamBodyAngleX', current.body * 2 + lookX * 3);
    setParam('ParamBodyAngleZ', lookX * 2);
    setParam('ParamEyeLOpen', current.eye);
    setParam('ParamEyeROpen', current.eye);
    setParam('ParamEyeBallX', lookX * 0.85);
    setParam('ParamEyeBallY', lookY * 0.85);
    setParam('ParamBrowLY', current.brow);
    setParam('ParamBrowRY', current.brow);
    setParam('ParamMouthOpenY', mouth);
    setParam('ParamMouthForm', current.form);
    setParam('ParamBreath', current.breath);
  }

  function fit() {
    if (!model) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // model.width/height 是「乘过 scale 之后」的值，先归零量出原始尺寸再算，否则会重复缩放
    model.scale.set(1);
    const rawW = model.width;
    const rawH = model.height;
    const scale = Math.min((w * 0.98) / rawW, (h * 0.96) / rawH);
    model.scale.set(scale);
    model.x = w / 2 - (rawW * scale) / 2;
    model.y = h - rawH * scale - 2;
  }

  async function waitCore(timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const c = window.Live2DCubismCore;
      if (c && c.Moc && c.Version) {
        try {
          if (c.Version.csmGetVersion()) return true;
        } catch { /* 未就绪 */ }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function init() {
    if (ready || app) return ready;
    try {
      if (!window.PIXI || !PIXI.live2d) throw new Error('PIXI.live2d 未加载');
      if (!(await waitCore())) throw new Error('Cubism Core 未就绪');

      const host = document.getElementById('pet-live2d-host');
      if (!host) throw new Error('缺少 pet-live2d-host 容器');

      app = new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        width: window.innerWidth,
        height: window.innerHeight
      });
      host.appendChild(app.view);
      console.log('[pet-live2d] canvas', app.view.width, app.view.height, 'host', host.clientWidth, host.clientHeight);

      model = await PIXI.live2d.Live2DModel.from(MODEL_URL, { autoInteract: false });
      app.stage.addChild(model);
      fit();
      window.addEventListener('resize', fit);

      core = model.internalModel.coreModel;
      model.internalModel.on('beforeModelUpdate', applyParams);
      console.log('[pet-live2d] 模型', Math.round(model.width), Math.round(model.height),
        'scale', model.scale.x.toFixed(3), 'pos', Math.round(model.x), Math.round(model.y));

      // 静止时放 Idle 动作，让呼吸/重心有底子
      model.motion('Idle');

      ready = true;
      document.body.dataset.live2d = 'on';
      console.log('[pet-live2d] 模型就绪');
      return true;
    } catch (err) {
      console.warn('[pet-live2d] 回退静态立绘：', err && err.message);
      document.body.dataset.live2d = 'off';
      if (app) {
        try { app.destroy(true, { children: true }); } catch { /* ignore */ }
        app = null;
      }
      return false;
    }
  }

  const api = {
    isReady: () => ready,
    init,
    setState(next) {
      if (!STATES[next]) return;
      state = next;
      target = { ...STATES[next] };
    },
    getState: () => state,
    setLook(x, y) {
      lookX = Math.max(-1, Math.min(1, x));
      lookY = Math.max(-1, Math.min(1, y));
    },
    speak() {
      speakUntil = performance.now() + 1400;
    },
    /* 四区互动：头/脸/身/脚各自给一点即时反馈 */
    onInteract(zone) {
      if (!ready) return;
      hopUntil = performance.now() + 420;
      const now = performance.now();
      if (zone === 'head') {
        target = { ...STATES[state], angleY: STATES[state].angleY - 14, angleX: 6 };
      } else if (zone === 'face') {
        target = { ...STATES[state], eye: 0.15, mouth: 0.5, form: 0.7 };
      } else if (zone === 'body') {
        target = { ...STATES[state], body: 6, angleZ: 5 };
      } else if (zone === 'feet') {
        target = { ...STATES[state], angleY: 8 };
        hopUntil = now + 620;
      }
      // 1.2 秒后回到当前状态
      setTimeout(() => { target = { ...STATES[state] }; }, 1200);
    }
  };

  window.petLive2d = api;
  // 脚本在 body 末尾，DOM 已就绪，直接开始初始化；失败会自己回退
  api.init();
})();
