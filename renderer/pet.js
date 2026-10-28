const petEl = document.getElementById('pet');
const petBody = document.getElementById('pet-body');
const petFace = document.getElementById('pet-face');
const stateEl = document.getElementById('pet-state');
const gestureEl = document.getElementById('pet-gesture');
const petHitArea = document.getElementById('pet-hit-area');
const bubble = document.getElementById('bubble');
const menu = document.getElementById('menu');
const statePill = document.getElementById('state-pill');
const stateDot = document.getElementById('state-dot');
const stateText = document.getElementById('state-text');
const statePanel = document.getElementById('status-panel');
const panelOnline = document.getElementById('panel-online');
const panelEmotion = document.getElementById('panel-emotion');
const panelRunning = document.getElementById('panel-running');
const panelReview = document.getElementById('panel-review');
const panelBlocked = document.getElementById('panel-blocked');
const panelQueue = document.getElementById('panel-queue');
const panelTask = document.getElementById('panel-task');
const panelAgents = document.getElementById('panel-agents');

let currentSrc = petBody.getAttribute('src');
let currentFaceKey = 'idle';
let faceTimer = null;
const blinkLayer = document.getElementById('pet-blink');

function paintFace(key) {
  const nextKey = String(key || 'idle');
  const src = window.pet.faceSources?.[nextKey];
  if (!src || nextKey === currentFaceKey) return;
  currentFaceKey = nextKey;
  petFace.classList.add('swapping');
  clearTimeout(faceTimer);
  faceTimer = setTimeout(() => {
    petFace.src = src;
    requestAnimationFrame(() => petFace.classList.remove('swapping'));
  }, 160);
}

/* ---------------- 眨眼（叠加帧交叉淡化，闭快睁慢，偶发双连眨） ---------------- */
function blinkOnce() {
  if (dragging || bubbleVisible() || menuOpen) return;
  if ((petEl.dataset.state || 'idle') !== 'idle') return;
  petEl.classList.add('blink');
  setTimeout(() => petEl.classList.remove('blink'), 85 + Math.random() * 35);
}

function scheduleBlink() {
  const base = 3000 + Math.random() * 5000;   // 3 ~ 8 秒一次
  const doDouble = Math.random() < 0.2;        // 20% 概率双连眨
  const gap = doDouble ? base : base + Math.random() * 2400;
  setTimeout(() => {
    blinkOnce();
    if (doDouble) setTimeout(() => blinkOnce(), 240 + Math.random() * 160);
    scheduleBlink();
  }, gap);
}

/* ---------------- 台词 ---------------- */
const LINES = [
  '好大爹，今天的活我看过了，随时能派。',
  '任务队列是空的，我在这儿候着。',
  '几个执行端都在，没掉线。',
  '本执事待命，说一声就动。',
  '别连着熬夜，这个我也记着。',
  '有活直接说，不用先寒暄。',
  '刚巡过一圈，没什么异常。'
];

let bubbleTimer = null;
function say(text, ms = 4200, options = {}) {
  // 三态气泡（普通 / 成功 / 出错）：颜色只在开口那一刻定，避免说话中途换皮
  bubble.classList.remove('tone-success', 'tone-error');
  if (options.kind === 'success') bubble.classList.add('tone-success');
  else if (options.kind === 'error') bubble.classList.add('tone-error');
  bubble.textContent = text;
  if (options.voice !== false) speakText(text);
  bubble.classList.remove('hidden');
  requestAnimationFrame(() => bubble.classList.add('show'));
  window.petLive2d?.speak();
  stateEl.classList.remove('squish');
  void petEl.offsetWidth;
  stateEl.classList.add('squish');
  setTimeout(() => stateEl.classList.remove('squish'), 430);
  window.pet.setIgnore(false);
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.classList.remove('show');
    setTimeout(() => {
      bubble.classList.add('hidden');
      updateIgnore(lastX, lastY);
    }, 200);
  }, ms);
}

async function sayAddressed(text, ms = 4200, options = {}) {
  const addressed = await window.pet.formatUtterance(text).catch(() => text);
  say(addressed, ms, options);
}

function bubbleVisible() {
  return bubble.classList.contains('show');
}

/* ---------------- 鼠标穿透 ---------------- */
let ignoring = false;
let lastX = -1;
let lastY = -1;
let lastActivityAt = Date.now();

function updateIgnore(x, y) {
  if (bubbleVisible() || menuOpen) {
    if (ignoring) { ignoring = false; window.pet.setIgnore(false); }
    return;
  }
  if (x < 0 || y < 0) return;
  const r = petHitArea.getBoundingClientRect();
  const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  if (inside === ignoring) {
    ignoring = !inside;
    window.pet.setIgnore(!inside);
  }
}

window.addEventListener('mousemove', (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
  const hit = petHitArea.getBoundingClientRect();
  if (e.clientX >= hit.left && e.clientX <= hit.right && e.clientY >= hit.top && e.clientY <= hit.bottom) {
    lastActivityAt = Date.now();
  }
  const bounds = petEl.getBoundingClientRect();
  const lookX = Math.max(-1, Math.min(1, (e.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)));
  const lookY = Math.max(-1, Math.min(1, (e.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)));
  petEl.style.setProperty('--look-x', `${(lookX * 2.2).toFixed(1)}px`);
  petEl.style.setProperty('--look-y', `${(lookY * 1.8).toFixed(1)}px`);
  window.petLive2d?.setLook(lookX, lookY);
  if (dragging) return;
  updateIgnore(e.clientX, e.clientY);
});

/* ---------------- 拖拽 / 点击 ---------------- */
let dragging = false;
let moved = 0;
let lastSX = 0;
let lastSY = 0;

function hitPetRegion(x, y) {
  return window.pet.hitRegion?.(x, y) || 'body';
}

petHitArea.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  lastActivityAt = Date.now();
  dragging = true;
  moved = 0;
  lastSX = e.screenX;
  lastSY = e.screenY;
  window.pet.dragBegin();
    petEl.style.animationPlayState = 'paused';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastSX;
  const dy = e.screenY - lastSY;
  if (dx || dy) {
    // 由主进程按光标绝对坐标定位，这里不再传增量，避免跨屏累积漂移
    window.pet.dragMove();
    lastSX = e.screenX;
    lastSY = e.screenY;
    moved += Math.abs(dx) + Math.abs(dy);
  }
});

/* 拖拽收尾：正常 mouseup 走这里，窗口失焦 / 鼠标在窗外松开也兜底，
 * 否则 dragging 会永久为 true——之后每次挪鼠标都在拖窗口，看起来就是「人乱跑后消失」。 */
function endDrag(commit) {
  if (!dragging) return;
  dragging = false;
  window.pet.dragEnd();
  petEl.style.animationPlayState = '';
  if (commit && moved < 5) {
    stateEl.classList.add('hop');
    setTimeout(() => stateEl.classList.remove('hop'), 520);
    const r = petHitArea.getBoundingClientRect();
    const x = (lastX - r.left) / r.width;
    const y = (lastY - r.top) / r.height;
    const zone = hitPetRegion(x, y);
    playAction(zone);
    window.petLive2d?.onInteract(zone);
    window.pet.interact(zone);
  }
  // 拖拽期间跳过了穿透判断，松手后补一次，避免变成「拖完无法点击」
  updateIgnore(lastX, lastY);
}

window.addEventListener('mouseup', () => endDrag(true));
window.addEventListener('blur', () => endDrag(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) endDrag(false);
});

/* ---------------- 拖文件创建 Hermes 任务 ---------------- */
petHitArea.addEventListener('dragenter', (event) => {
  event.preventDefault();
  petEl.classList.add('drop-target');
});
petHitArea.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
petHitArea.addEventListener('dragleave', (event) => {
  if (!petHitArea.contains(event.relatedTarget)) petEl.classList.remove('drop-target');
});
petHitArea.addEventListener('drop', async (event) => {
  event.preventDefault();
  petEl.classList.remove('drop-target');
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.path);
  if (!files.length) return sayAddressed('没拿到文件路径，无法派发。打开聊天窗也能创建任务。', 5000, { kind: 'error' });
  const title = files.length === 1 ? files[0].name : `处理 ${files.length} 个文件`;
  await sayAddressed(`收到「${title}」，正在交给 Hermes…`, 8000);
  const created = await window.pet.createTask({
    title,
    body: `请处理拖入的文件：${files.map((file) => file.name).join('、')}`,
    triage: true
  });
  if (!created?.ok) return say(created?.error || '任务没建成：Hermes 暂不可用', 6500, { kind: 'error' });
  const task = created.task?.task || created.task || {};
  const taskId = task.id;
  if (taskId == null) return sayAddressed('任务已创建，但 Hermes 没返回任务编号，附件未上传。', 6500, { kind: 'error' });
  for (const file of files) {
    const uploaded = await window.pet.uploadTaskFile(taskId, file.path);
    if (!uploaded?.ok) return say(uploaded?.error || `任务已建成，但「${file.name}」上传失败：未知错误`, 6500, { kind: 'error' });
  }
  sayAddressed(`「${title}」已派发，${files.length} 个附件已交给 Hermes。`, 5200, { kind: 'success' });
});

/* ---------------- 右键菜单 ---------------- */
let menuOpen = false;

function paintState(state) {
  const s = state || {};
  stateText.textContent = s.hermesText || s.statusText || 'Hermes 离线';
  statePill.dataset.state = s.status || 'idle';
  stateDot.dataset.state = s.status || 'idle';
  petEl.dataset.state = s.status || 'idle';
  petEl.dataset.emotion = s.emotion || '平静';
  const emotionFace = {
    '平静': 'idle', '开心': 'happy', '得意': 'smug', '犯困': 'sleepy',
    '有点烦': 'frown', '闹别扭': 'speechless', '兴奋': 'surprised', '委屈': 'shy'
  };
  const stateFace = {
    success: 'happy', sleep: 'sleepy', thinking: 'thinking', working: 'thinking'
  };
  const face = s.status === 'error'
    ? ((s.failureSeverity === 'high' || s.mood <= 25) ? 'cry' : 'angry')
    : stateFace[s.status] || emotionFace[s.emotion] || 'idle';
  petEl.dataset.face = face;
  paintFace(face);
  const bodyState = ['idle', 'working', 'thinking', 'success', 'sleep', 'error'].includes(s.status)
    ? s.status : 'idle';
  const nextSrc = window.pet.stateSources?.[bodyState] || window.pet.stateSources?.idle;
  if (nextSrc && nextSrc !== currentSrc) {
    currentSrc = nextSrc;
    petBody.src = nextSrc;
  }
  stateEl.classList.toggle('thinking', s.status === 'thinking');
  stateEl.classList.toggle('working', s.status === 'working');
  stateEl.classList.toggle('success', s.status === 'success');
  stateEl.classList.toggle('error', s.status === 'error');
  stateEl.classList.toggle('sleep', s.status === 'sleep');
  window.petLive2d?.setState(bodyState);
  panelOnline.textContent = s.hermesOnline ? `在线 · ${s.port ? `端口 ${s.port}` : '服务正常'}` : '离线（等待 Hermes 服务）';
  panelEmotion.textContent = `${s.emotion || '平静'} · ${s.address || '好大爹'}`;
  panelRunning.textContent = s.runningCount || 0;
  panelReview.textContent = s.queue?.review || 0;
  panelBlocked.textContent = s.queue?.blocked || 0;
  panelQueue.textContent = (s.queue?.todo || 0) + (s.queue?.ready || 0) + (s.queue?.scheduled || 0);
  panelTask.textContent = s.currentTask ? `当前：${s.currentTask.title}${s.currentTask.assignee ? ` · ${s.currentTask.assignee}` : ''}` : '当前没有执行中的任务';
  panelAgents.innerHTML = (s.agents || []).map((agent) => `<span class="${agent.status}">${agent.name}${agent.status === 'working' ? ' · 工作中' : ' · 空闲'}</span>`).join('');
  if (s.status !== 'idle') {
    stateEl.classList.remove('drowsy');
    petEl.classList.remove('blink');
  }
}

window.pet.onState(paintState);
window.pet.getState().then(paintState).catch(() => {});
window.pet.onAnnounce((text, options) => {
  say(text, options.kind === 'error' ? 6000 : 4800, { voice: options.voice, kind: options.kind });
});
statePill.addEventListener('click', (e) => {
  e.stopPropagation();
  statePanel.classList.toggle('hidden');
  window.pet.setIgnore(false);
});
window.addEventListener('mousedown', (e) => {
  if (!statePanel.contains(e.target) && e.target !== statePill) statePanel.classList.add('hidden');
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // 菜单改到独立小窗里弹，贴着角色侧边，不再压在身上
  window.pet.openMenu();
});

window.pet.onMenuAction((act) => {
  if (act === 'talk') sayAddressed(LINES[Math.floor(Math.random() * LINES.length)]);
});

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.add('hidden');
  updateIgnore(lastX, lastY);
}

menu.addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  closeMenu();
  switch (act) {
    case 'chat':
      window.pet.openChat();
      break;
    case 'talk':
      sayAddressed(LINES[Math.floor(Math.random() * LINES.length)]);
      break;
    case 'snap':
      window.pet.snapCorner();
      break;
    case 'top':
      window.pet.toggleTop();
      break;
    case 'autostart':
      window.pet.toggleAutostart();
      break;
    case 'dir':
      window.pet.openHermesDir();
      break;
    case 'hide':
      window.pet.hidePet();
      break;
    case 'quit':
      window.pet.quit();
      break;
  }
});

window.addEventListener('mousedown', (e) => {
  if (menuOpen && !menu.contains(e.target)) closeMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
  if (e.key === 'F1') sayAddressed(LINES[0]);
});

/* ---------------- 互动动作与待机小动作 ---------------- */
let lastActionId = '';
let gestureTimer = null;
let gestureAnimationHandler = null;

function clearGesture() {
  if (gestureTimer) clearTimeout(gestureTimer);
  gestureTimer = null;
  if (gestureAnimationHandler) gestureEl.removeEventListener('animationend', gestureAnimationHandler);
  gestureAnimationHandler = null;
  gestureEl.classList.remove('gesture-active');
  delete gestureEl.dataset.action;
}

function spawnActionEffect(effect) {
  if (!fxLayer || !effect) return;
  const img = document.createElement('img');
  img.className = 'fx-action';
  img.src = `../assets/fx/png/fx-${effect}.png`;
  img.alt = '';
  img.draggable = false;
  img.style.left = `${38 + Math.random() * 24}%`;
  img.style.setProperty('--drift', `${(Math.random() * 30 - 15).toFixed(0)}px`);
  fxLayer.appendChild(img);
  setTimeout(() => img.remove(), 1500);
}

function playAction(group) {
  const action = window.pet.chooseAction?.(group, lastActionId);
  if (!action) return;
  clearGesture();
  lastActionId = action.id;
  gestureEl.dataset.action = action.id;
  gestureEl.style.setProperty('--gesture-ms', action.duration);
  void gestureEl.offsetWidth;
  gestureEl.classList.add('gesture-active');
  spawnActionEffect(action.effect);
  gestureAnimationHandler = (event) => {
    if (event.target === gestureEl && event.animationName === action.animation) clearGesture();
  };
  gestureEl.addEventListener('animationend', gestureAnimationHandler);
  gestureTimer = setTimeout(clearGesture, action.duration + 120);
}

function idleLoop() {
  const wait = 6000 + Math.random() * 7000;
  setTimeout(() => {
    if (!dragging && !bubbleVisible() && (petEl.dataset.state || 'idle') === 'idle') {
      playAction('all');
    }
    idleLoop();
  }, wait);
}
idleLoop();
scheduleBlink();
setInterval(() => {
  const idleFor = Date.now() - lastActivityAt;
  const isCalm = petEl.dataset.state === 'idle' && !dragging && !bubbleVisible();
  stateEl.classList.toggle('drowsy', isCalm && idleFor >= 20 * 60000);
}, 30000);
petHitArea.addEventListener('mouseenter', () => {
  lastActivityAt = Date.now();
  stateEl.classList.remove('drowsy');
});

/* ---------------- 托盘消息 ---------------- */
window.pet.onToast((text) => sayAddressed(text, 1800));


/* ---------------- 悬停摸头 ---------------- */
/* 对标 DSH 的「摸头互动」：鼠标在头顶停留一会儿就主动回应，而不是必须点一下。
 * 触发后进入冷却，避免鼠标停在上面时反复刷屏。 */
const fxLayer = document.getElementById('pet-fx');
const HEAD_LINES = [
  '……帽子要歪了。',
  '唔，头发会乱。',
  '摸一下就够了吧。',
  '手凉，先去忙正事。',
  '我知道你在，不用一直摸。'
];
let hoverHeadSince = 0;
let lastPetAt = 0;

function spawnHeart() {
  if (!fxLayer) return;
  const img = document.createElement('img');
  img.className = 'fx-heart';
  img.src = '../assets/fx/png/fx-heart.png';
  img.alt = '';
  img.draggable = false;
  img.style.left = `${34 + Math.random() * 32}%`;
  img.style.setProperty('--drift', `${(Math.random() * 34 - 17).toFixed(0)}px`);
  img.style.animationDelay = `${Math.round(Math.random() * 170)}ms`;
  fxLayer.appendChild(img);
  setTimeout(() => img.remove(), 1800);
}

function petHead() {
  const now = Date.now();
  if (now - lastPetAt < 6000) return;
  lastPetAt = now;
  for (let i = 0; i < 3; i++) spawnHeart();
  playAction('head');
  window.petLive2d?.onInteract('head');
  say(HEAD_LINES[Math.floor(Math.random() * HEAD_LINES.length)], 2400);
}

window.addEventListener('mousemove', (e) => {
  if (dragging || bubbleVisible()) { hoverHeadSince = 0; return; }
  const r = petHitArea.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const inPet = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  const zone = inPet ? hitPetRegion(x, y) : null;
  if (zone !== 'head') { hoverHeadSince = 0; return; }
  if (!hoverHeadSince) { hoverHeadSince = Date.now(); return; }
  if (Date.now() - hoverHeadSince >= 480) {
    hoverHeadSince = 0;
    petHead();
  }
});

/* ---------------- 语音播报（系统离线语音，零 API 成本） ---------------- */
const voiceCache = { enabled: true, name: '', rate: 100, volume: 85 };

function pickChineseVoice() {
  let voices = [];
  try { voices = speechSynthesis.getVoices() || []; } catch { return null; }
  const zh = voices.filter((v) => /^zh/i.test(v.lang) || /Chinese|Huihui|Yaoyao|Kangkang|Xiaoxiao/i.test(v.name));
  if (!zh.length) return null;
  if (voiceCache.name) {
    const hit = zh.find((v) => v.name === voiceCache.name);
    if (hit) return hit;
  }
  return zh.find((v) => /Huihui|Yaoyao|Xiaoxiao|Female|女/i.test(v.name)) || zh[0];
}

function speakText(text) {
  if (!voiceCache.enabled) return;
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[#*_>~]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  if (!clean) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickChineseVoice();
    if (v) u.voice = v;
    u.lang = 'zh-CN';
    u.rate = (voiceCache.rate || 100) / 100;
    u.volume = (voiceCache.volume == null ? 85 : voiceCache.volume) / 100;
    speechSynthesis.speak(u);
  } catch { /* 没有可用语音就静默 */ }
}

function applyPetSettings(s) {
  if (!s) return;
  voiceCache.enabled = s.voiceEnabled !== false;
  voiceCache.name = s.voiceName || '';
  voiceCache.rate = s.voiceRate || 100;
  voiceCache.volume = s.volume === undefined ? (s.voiceVolume == null ? 85 : s.voiceVolume) : s.volume;
  if (s.lineFrequency) lineFrequency = s.lineFrequency;
  if (s.petOpacity != null) petEl.style.opacity = String(Math.max(40, Math.min(100, s.petOpacity)) / 100);
}

let lineFrequency = 'normal';
window.pet.getSettings().then(applyPetSettings).catch(() => {});
window.pet.onSettingsChanged(applyPetSettings);
window.pet.onAppearance((v) => {
  if (v && v.opacity != null) petEl.style.opacity = String(v.opacity);
});

/* 待机时按「台词频率」偶尔主动说一句 */
setInterval(() => {
  if (lineFrequency === 'quiet') return;
  if (dragging || bubbleVisible() || menuOpen) return;
  if ((petEl.dataset.state || 'idle') !== 'idle') return;
  if (Date.now() - lastActivityAt < 60000) return;
  const chance = lineFrequency === 'chatty' ? 0.55 : 0.25;
  if (Math.random() > chance) return;
  sayAddressed(LINES[Math.floor(Math.random() * LINES.length)], 3600);
}, 90000);
