const petEl = document.getElementById('pet');
const petBody = document.getElementById('pet-body');
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
const BLINK_SRC = '../assets/states/v2/aligned/state/state-idle-blink.png';

/* ---------------- 眨眼 ---------------- */
function blinkOnce() {
  if (dragging || bubbleVisible()) return;
  if ((petEl.dataset.state || 'idle') !== 'idle') return;
  const restore = currentSrc;
  petBody.src = BLINK_SRC;
  setTimeout(() => {
    if (currentSrc === restore) petBody.src = restore;
  }, 110);
}

function blinkLoop() {
  setTimeout(() => {
    blinkOnce();
    blinkLoop();
  }, 3800 + Math.random() * 5200);
}

/* ---------------- 台词 ---------------- */
const LINES = [
  '大哥，今天的活我看过了，随时能派。',
  '任务队列是空的，我在这儿候着。',
  '几个执行端都在，没掉线。',
  '本执事待命，说一声就动。',
  '别连着熬夜，这个我也记着。',
  '有活直接说，不用先寒暄。',
  '刚巡过一圈，没什么异常。'
];

let bubbleTimer = null;
function say(text, ms = 4200) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  requestAnimationFrame(() => bubble.classList.add('show'));
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

async function sayAddressed(text, ms = 4200) {
  const addressed = await window.pet.formatUtterance(text).catch(() => text);
  say(addressed, ms);
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
    petEl.style.animationPlayState = 'paused';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastSX;
  const dy = e.screenY - lastSY;
  if (dx || dy) {
    window.pet.moveTo(dx, dy);
    lastSX = e.screenX;
    lastSY = e.screenY;
    moved += Math.abs(dx) + Math.abs(dy);
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
    petEl.style.animationPlayState = '';
  if (moved < 5) {
    petEl.classList.add('hop');
    setTimeout(() => petEl.classList.remove('hop'), 520);
    const r = petHitArea.getBoundingClientRect();
    const x = (lastX - r.left) / r.width;
    const y = (lastY - r.top) / r.height;
    window.pet.interact(hitPetRegion(x, y));
  }
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
  if (!files.length) return sayAddressed('没拿到文件路径，无法派发。打开聊天窗也能创建任务。', 5000);
  const title = files.length === 1 ? files[0].name : `处理 ${files.length} 个文件`;
  await sayAddressed(`收到「${title}」，正在交给 Hermes…`, 8000);
  const created = await window.pet.createTask({
    title,
    body: `请处理拖入的文件：${files.map((file) => file.name).join('、')}`,
    triage: true
  });
  if (!created?.ok) return say(created?.error || '任务没建成：Hermes 暂不可用', 6500);
  const task = created.task?.task || created.task || {};
  const taskId = task.id;
  if (taskId == null) return sayAddressed('任务已创建，但 Hermes 没返回任务编号，附件未上传。', 6500);
  for (const file of files) {
    const uploaded = await window.pet.uploadTaskFile(taskId, file.path);
    if (!uploaded?.ok) return say(uploaded?.error || `任务已建成，但「${file.name}」上传失败：未知错误`, 6500);
  }
  sayAddressed(`「${title}」已派发，${files.length} 个附件已交给 Hermes。`, 5200);
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
  const faceByState = {
    idle: 'idle', success: 'happy', sleep: 'sleepy',
    thinking: 'thinking', working: 'thinking', error: 'angry'
  };
  const face = ['idle', 'happy', 'sleepy', 'thinking', 'angry', 'cry'].includes(s.face)
    ? s.face
    : faceByState[s.status] || 'idle';
  petEl.dataset.face = s.status === 'error' && (s.failureSeverity === 'high' || s.mood <= 25) ? 'cry' : face;
  const bodyState = ['idle', 'working', 'thinking', 'success', 'sleep', 'error'].includes(s.status)
    ? s.status : 'idle';
  const nextSrc = window.pet.stateSources?.[bodyState] || window.pet.stateSources?.idle;
  if (nextSrc && nextSrc !== currentSrc) {
    currentSrc = nextSrc;
    petBody.src = nextSrc;
  }
  petEl.classList.toggle('thinking', s.status === 'thinking');
  petEl.classList.toggle('working', s.status === 'working');
  petEl.classList.toggle('success', s.status === 'success');
  petEl.classList.toggle('error', s.status === 'error');
  petEl.classList.toggle('sleep', s.status === 'sleep');
  panelOnline.textContent = s.hermesOnline ? `在线 · ${s.port ? `端口 ${s.port}` : '服务正常'}` : '离线（等待 Hermes 服务）';
  panelEmotion.textContent = `${s.emotion || '平静'} · ${s.address || '大哥'}`;
  panelRunning.textContent = s.runningCount || 0;
  panelReview.textContent = s.queue?.review || 0;
  panelBlocked.textContent = s.queue?.blocked || 0;
  panelQueue.textContent = (s.queue?.todo || 0) + (s.queue?.ready || 0) + (s.queue?.scheduled || 0);
  panelTask.textContent = s.currentTask ? `当前：${s.currentTask.title}${s.currentTask.assignee ? ` · ${s.currentTask.assignee}` : ''}` : '当前没有执行中的任务';
  panelAgents.innerHTML = (s.agents || []).map((agent) => `<span class="${agent.status}">${agent.name}${agent.status === 'working' ? ' · 工作中' : ' · 空闲'}</span>`).join('');
  if (s.status !== 'idle') petEl.classList.remove('drowsy');
}

window.pet.onState(paintState);
window.pet.getState().then(paintState).catch(() => {});
window.pet.onAnnounce((text, options) => {
  say(text, options.kind === 'error' ? 6000 : 4800);
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
  menuOpen = true;
  menu.classList.remove('hidden');
  window.pet.setIgnore(false);
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

/* ---------------- 待机小动作 ---------------- */
function idleLoop() {
  const wait = 7000 + Math.random() * 8000;
  setTimeout(() => {
    if (!dragging && !bubbleVisible()) {
      petEl.style.setProperty('--sway-dir', Math.random() < 0.5 ? '-1' : '1');
      petEl.classList.add('sway');
      setTimeout(() => petEl.classList.remove('sway'), 1900);
    }
    idleLoop();
blinkLoop();
  }, wait);
}
idleLoop();
setInterval(() => {
  const idleFor = Date.now() - lastActivityAt;
  const isCalm = petEl.dataset.state === 'idle' && !dragging && !bubbleVisible();
  petEl.classList.toggle('drowsy', isCalm && idleFor >= 20 * 60000);
}, 30000);
petHitArea.addEventListener('mouseenter', () => {
  lastActivityAt = Date.now();
  petEl.classList.remove('drowsy');
});

/* ---------------- 托盘消息 ---------------- */
window.pet.onToast((text) => sayAddressed(text, 1800));

