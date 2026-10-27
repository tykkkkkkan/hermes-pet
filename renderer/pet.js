const petEl = document.getElementById('pet');
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

function bubbleVisible() {
  return bubble.classList.contains('show');
}

/* ---------------- 鼠标穿透 ---------------- */
let ignoring = false;
let lastX = -1;
let lastY = -1;

function updateIgnore(x, y) {
  if (bubbleVisible() || menuOpen) {
    if (ignoring) { ignoring = false; window.pet.setIgnore(false); }
    return;
  }
  if (x < 0 || y < 0) return;
  const r = petEl.getBoundingClientRect();
  const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  if (inside === ignoring) {
    ignoring = !inside;
    window.pet.setIgnore(!inside);
  }
}

window.addEventListener('mousemove', (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
  if (dragging) return;
  updateIgnore(e.clientX, e.clientY);
});

/* ---------------- 拖拽 / 点击 ---------------- */
let dragging = false;
let moved = 0;
let lastSX = 0;
let lastSY = 0;

petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
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
    say(LINES[Math.floor(Math.random() * LINES.length)]);
  }
});

/* ---------------- 右键菜单 ---------------- */
let menuOpen = false;

function paintState(state) {
  const s = state || {};
  stateText.textContent = s.hermesText || s.statusText || 'Hermes 离线';
  statePill.dataset.state = s.status || 'idle';
  stateDot.dataset.state = s.status || 'idle';
  petEl.dataset.state = s.status || 'idle';
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
      say(LINES[Math.floor(Math.random() * LINES.length)]);
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
  if (e.key === 'F1') say(LINES[0]);
});

/* ---------------- 待机小动作 ---------------- */
function idleLoop() {
  const wait = 7000 + Math.random() * 8000;
  setTimeout(() => {
    if (!dragging) {
      petEl.classList.add('sway');
      setTimeout(() => petEl.classList.remove('sway'), 1150);
    }
    idleLoop();
  }, wait);
}
idleLoop();

/* ---------------- 托盘消息 ---------------- */
window.pet.onToast((text) => say(text, 1800));

