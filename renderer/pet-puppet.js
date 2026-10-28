/* 自研 2.5D 分层渲染器（Puppet）。
 *
 * 不依赖 Live2D 运行时，用 PixiJS 对「头部 / 眼睛 / 嘴巴 / 身体」四层做变换，
 * 实现扭头、眨眼、视线跟随、说话口型、呼吸与互动反馈。
 *
 * 素材来自 tools/build-pet-layers.js 拆出的图层，与角色原立绘逐像素对齐。
 * 对外接口与 pet-live2d.js 完全一致，pet.js 无需改动。
 * 任何一步失败都静默回退静态立绘。
 */
(function () {
  const BASE = 'petasset://app/assets/pet-layers/';

  /* 六态参数：头部倾角 / 头部纵向偏移 / 眼睛开合 / 嘴部开合 / 呼吸强度 / 身体侧倾 */
  const STATES = {
    idle: { rot: 0, dy: 0, eye: 1, mouth: 0, breath: 1, lean: 0 },
    thinking: { rot: -6.5, dy: -8, eye: 0.94, mouth: 0, breath: 1, lean: -1 },
    working: { rot: 3.5, dy: 2, eye: 0.97, mouth: 0, breath: 1.35, lean: 1.2 },
    success: { rot: 0, dy: -10, eye: 0.3, mouth: 0.55, breath: 1.1, lean: 0 },
    error: { rot: -1, dy: 9, eye: 0.52, mouth: 0.15, breath: 0.8, lean: -1.5 },
    sleep: { rot: -4, dy: 10, eye: 0, mouth: 0, breath: 0.65, lean: -2 }
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let app = null;
  let root = null, jumpC = null, breathe = null, headC = null;
  let bodySprite = null, headSprite = null, eyesSprite = null, mouthSprite = null;
  let shadowSprite = null;
  const shadowScale = { x: 1, y: 1 };
  let meta = null;
  let ready = false;
  let state = 'idle';
  let target = { ...STATES.idle };
  let cur = { ...STATES.idle };

  let lookX = 0, lookY = 0, lookCX = 0, lookCY = 0;
  let speakUntil = 0;
  const imp = { rot: 0, dy: 0, lean: 0, jump: 0 };
  let blinkAt = -1, blinkQueue = 0;

  function scheduleBlink(now) {
    blinkAt = now + 2800 + Math.random() * 3600;
    blinkQueue = Math.random() < 0.18 ? 1 : 0;
  }

  /* 返回 0..1 的眼睛开合系数：闭得快、睁得慢，偶发双连眨 */
  function blinkFactor(now) {
    if (blinkAt < 0) { scheduleBlink(now); return 1; }
    if (now < blinkAt) return 1;
    const t = now - blinkAt;
    const CLOSE = 58, TOTAL = 190;
    if (t <= TOTAL) return t < CLOSE ? 1 - t / CLOSE : (t - CLOSE) / (TOTAL - CLOSE);
    if (blinkQueue > 0) { blinkQueue--; blinkAt = now + 105; return 1; }
    scheduleBlink(now);
    return 1;
  }

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      const tex = PIXI.Texture.from(url);
      if (tex.baseTexture.valid) return resolve(tex);
      tex.baseTexture.once('loaded', () => resolve(tex));
      tex.baseTexture.once('error', () => reject(new Error('纹理加载失败: ' + url)));
    });
  }

  function makeSprite(tex, x, y, anchorX, anchorY) {
    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(anchorX, anchorY);
    sp.position.set(x, y);
    return sp;
  }

  /* 尺寸与缩放必须同源：之前用 window.innerWidth 算缩放，却没同步 canvas 尺寸。
   * 窗口被拖动时 innerWidth 会漂移（实测 228 → 238），于是模型按新尺寸放大、
   * 但画布还是旧尺寸，人物就被裁切甚至只剩中间一块。
   * 现在统一以渲染容器（#pet）的实际尺寸为准，并在 DPI 变化时重设 resolution。 */
  function fit() {
    if (!app || !root || !meta) return;
    const host = app.view.parentElement || document.getElementById('pet-live2d-host');
    const w = Math.max(1, host.clientWidth || window.innerWidth);
    const h = Math.max(1, host.clientHeight || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;

    const curW = Math.round(app.renderer.width / app.renderer.resolution);
    const curH = Math.round(app.renderer.height / app.renderer.resolution);
    if (curW !== w || curH !== h || app.renderer.resolution !== dpr) {
      app.renderer.resolution = dpr;
      app.renderer.resize(w, h);
    }

    const cw = meta.canvas.width, ch = meta.canvas.height;
    const s = Math.min((w * 0.99) / cw, (h * 0.98) / ch);
    root.scale.set(s);
    // 脚底留一条屏幕空间给投影，否则影子会被窗口裁掉，角色又回到"浮着"的状态
    const shadowPad = Math.max(9, ch * s * 0.026);
    root.position.set(w / 2 - (cw * s) / 2, h - ch * s - shadowPad);
  }

  async function init() {
    if (ready || app) return ready;
    if (new URLSearchParams(location.search).get('live2d') === '0') {
      document.body.dataset.live2d = 'off';
      console.log('[pet-puppet] 已按配置停用，使用静态立绘');
      return false;
    }
    try {
      if (!window.PIXI) throw new Error('PIXI 未加载');
      const host = document.getElementById('pet-live2d-host');
      if (!host) throw new Error('缺少渲染容器');

      const metaRes = await fetch(BASE + 'meta.json', { cache: 'no-store' });
      if (!metaRes.ok) throw new Error('meta.json 读取失败 ' + metaRes.status);
      meta = await metaRes.json();

      const [bodyTex, headTex, eyesTex, mouthTex, shadowTex] = await Promise.all([
        loadTexture(BASE + 'body.png'),
        loadTexture(BASE + 'head.png'),
        loadTexture(BASE + 'eyes.png'),
        loadTexture(BASE + 'mouth.png'),
        // 投影是加分项，缺了也要照常渲染，所以单独兜住失败
        loadTexture(BASE + 'shadow.png').catch(() => null)
      ]);

      app = new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        width: window.innerWidth,
        height: window.innerHeight
      });
      host.appendChild(app.view);

      const cw = meta.canvas.width;
      const ch = meta.canvas.height;
      const pivX = meta.head.pivotX;
      const pivY = meta.head.pivotY;

      root = new PIXI.Container();
      jumpC = new PIXI.Container();
      breathe = new PIXI.Container();
      headC = new PIXI.Container();

      // 呼吸以脚底为基准缩放，看起来像重心起伏而不是整体膨胀
      breathe.pivot.set(0, ch);
      breathe.position.set(0, ch);

      bodySprite = new PIXI.Sprite(bodyTex);
      bodySprite.anchor.set(0, 0);

      /* 脚底投影：贴在画布底部，不跟随 jumpC 上浮，
       * 这样跳起来时影子留在原位缩小变淡，人才真的"离开地面"。 */
      if (shadowTex) {
        shadowSprite = new PIXI.Sprite(shadowTex);
        shadowSprite.anchor.set(0.5, 0.5);
        shadowSprite.position.set(cw / 2, ch - 6);
        shadowScale.x = (cw * 0.8) / shadowTex.width;
        shadowScale.y = (ch * 0.055) / shadowTex.height;
        shadowSprite.scale.set(shadowScale.x, shadowScale.y);
        shadowSprite.alpha = 0.92;
      }

      // 头部容器绕脖子根部旋转
      headC.pivot.set(pivX, pivY);
      headC.position.set(pivX, pivY);

      headSprite = new PIXI.Sprite(headTex);
      headSprite.anchor.set(0, 0);

      const e = meta.eyes;
      // 锚点放在眼睛下沿：眯眼时上眼睑向下压、下沿不动，才像真实的半闭眼
      eyesSprite = makeSprite(eyesTex, e.x + e.w / 2, e.y + e.h, 0.5, 1);

      const m = meta.mouth;
      // 嘴部锚点靠上：张口时从上唇向下展开，符合说话的动作方向
      mouthSprite = makeSprite(mouthTex, m.x + m.w / 2, m.y + m.h * 0.18, 0.5, 0.18);
      mouthSprite.alpha = 0;

      headC.addChild(headSprite, eyesSprite, mouthSprite);
      breathe.addChild(bodySprite, headC);
      jumpC.addChild(breathe);
      if (shadowSprite) root.addChild(shadowSprite);
      root.addChild(jumpC);
      app.stage.addChild(root);
      fit();
      window.addEventListener('resize', fit);

      app.ticker.add(tick);

      ready = true;
      document.body.dataset.live2d = 'on';
      console.log('[pet-puppet] 图层就绪', cw + 'x' + ch, '切缝 y=' + pivY);
      return true;
    } catch (err) {
      console.warn('[pet-puppet] 回退静态立绘：', err && err.message);
      document.body.dataset.live2d = 'off';
      if (app) {
        try { app.destroy(true, { children: true }); } catch { /* ignore */ }
        app = null;
      }
      return false;
    }
  }

  function tick() {
    if (!ready) return;
    const now = performance.now();

    // 每 30 帧校正一次尺寸：跨屏 DPI 变化、窗口被系统微调时不一定有 resize 事件
    if ((tick.frames = (tick.frames || 0) + 1) % 30 === 0) fit();

    for (const k of Object.keys(STATES.idle)) cur[k] = lerp(cur[k], target[k], 0.075);
    lookCX = lerp(lookCX, lookX, 0.11);
    lookCY = lerp(lookCY, lookY, 0.11);

    /* 眼睛：以纵向压缩表现眯眼（上下自然露出眼皮），只在接近闭合时才收 alpha。
       直接用 alpha 淡出会让半睁状态的眼睛发灰透明，观感很差。 */
    const openness = clamp(cur.eye * blinkFactor(now), 0, 1);
    eyesSprite.scale.y = 0.12 + 0.88 * openness;
    eyesSprite.alpha = openness < 0.18 ? openness / 0.18 : 1;
    eyesSprite.position.set(
      meta.eyes.x + meta.eyes.w / 2 + lookCX * 3.2,
      meta.eyes.y + meta.eyes.h + lookCY * 2.1
    );

    /* 头部：状态倾角 + 视线跟随 + 互动冲量。
       再加两笔透视：转头时沿 X 轴压扁（cos 效应）+ 轻微斜切，
       这是"一张平面的脸"变成"有体积的头"最关键的一步。 */
    const rotDeg = cur.rot + lookCX * 7.2 + imp.rot;
    headC.rotation = (rotDeg * Math.PI) / 180;
    headC.position.set(meta.head.pivotX + lookCX * 3.4, meta.head.pivotY + cur.dy + lookCY * 2 + imp.dy);
    headC.scale.x = 1 - Math.abs(lookCX) * 0.085;
    headC.skew.x = -lookCX * 0.072;

    /* 嘴部：说话时按语音节奏开合，节拍不依赖 TTS */
    const speaking = now < speakUntil;
    let mouthOpen = cur.mouth;
    if (speaking) {
      const beat = Math.sin(now / 88) * 0.5 + 0.5;
      mouthOpen = Math.max(mouthOpen, 0.35 + beat * 0.55);
      headC.rotation += Math.sin(now / 210) * 0.012;
    }
    // 张开幅度决定不透明度：一旦开口就基本实心，避免半透明嘴
    mouthSprite.alpha = Math.min(1, mouthOpen * 1.7);
    mouthSprite.scale.y = 0.84 + 0.16 * clamp(mouthOpen, 0, 1);

    /* 呼吸与重心摆动。
       身体横向位移与视线相反（对立式）：头往左看、身子微往右，
       才有"转身"的体积感，而不是整只角色一起平移。 */
    const breath = Math.sin((now / 1080) * cur.breath) * 0.0085;
    breathe.scale.y = 1 + breath;
    breathe.scale.x = 1 - breath * 0.45;
    breathe.x = Math.sin(now / 2700) * 1.1 + cur.lean * 0.35 - lookCX * 1.5;
    breathe.rotation = -lookCX * 0.012;

    /* 投影：起跳时缩小变淡、呼吸时跟着起伏，影子是"离地"的唯一线索 */
    if (shadowSprite) {
      const lift = Math.max(0, -imp.jump) / 16;
      shadowSprite.scale.set(
        shadowScale.x * (1 - lift * 0.24) * (1 + breath * 0.6),
        shadowScale.y * (1 - lift * 0.3)
      );
      shadowSprite.alpha = 0.92 - lift * 0.5;
      shadowSprite.x = meta.canvas.width / 2 - lookCX * 6;
    }

    /* 跳跃冲量 */
    jumpC.y = imp.jump;

    imp.rot *= 0.9;
    imp.dy *= 0.9;
    imp.lean *= 0.92;
    imp.jump *= 0.85;
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
      lookX = clamp(x, -1, 1);
      lookY = clamp(y, -1, 1);
    },
    speak() {
      speakUntil = performance.now() + 1400;
    },
    onInteract(zone) {
      if (!ready) return;
      if (zone === 'head') {
        imp.rot = -10;
        imp.dy = -4;
      } else if (zone === 'face') {
        blinkAt = performance.now();
        blinkQueue = 1;
      } else if (zone === 'body') {
        imp.lean = 5;
        imp.rot = 3;
      } else if (zone === 'feet') {
        imp.jump = -14;
      }
      setTimeout(() => { imp.rot = 0; imp.dy = 0; imp.lean = 0; }, 700);
    }
  };

  window.petLive2d = api;
  window.__petPuppetDebug = () => (shadowSprite ? {
    shadow: {
      w: shadowSprite.width,
      h: shadowSprite.height,
      alpha: shadowSprite.alpha,
      x: shadowSprite.x,
      y: shadowSprite.y,
      visible: shadowSprite.visible,
      inRoot: !!(root && root.children.indexOf(shadowSprite) >= 0)
    },
    rootChildren: root ? root.children.length : -1,
    stageScale: root ? root.scale.x : -1,
    rootY: root ? root.position.y : -1
  } : { shadow: null, rootChildren: root ? root.children.length : -1 });
  api.init();
})();
