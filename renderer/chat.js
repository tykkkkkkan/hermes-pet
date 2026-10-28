const $ = (id) => document.getElementById(id);
let sending = false;
let droppedFiles = [];
let recognition = null;
let listening = false;

async function addressed(text) {
  return window.pet.formatUtterance(text).catch(() => String(text || ''));
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

function addMessage(role, text, at) {
  const row = document.createElement('article');
  row.className = `message ${role === 'user' ? 'mine' : 'hers'}`;
  row.innerHTML = `
    <div class="message-meta">${role === 'user' ? '你' : 'Hermes'}${at ? ` · ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
    <div class="message-body">${esc(text).replace(/\n/g, '<br />')}</div>
    ${role === 'assistant' ? '<button class="read-message" type="button" title="朗读这条回复">朗读</button>' : ''}`;
  $('messages').appendChild(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function paintState(state) {
  if (!state) return;
  $('mood').textContent = `心情 ${state.mood}/100 · 好感 ${state.affection}/100`;
  $('connection-state').textContent = state.hermesText || state.statusText || 'Hermes 离线';
}

let settingsCache = {};

/* 把数值同步到滑块的百分比显示 */
function paintSlider(id, valId, value) {
  const el = $(id);
  const out = $(valId);
  if (el) el.value = String(value);
  if (out) out.textContent = `${value}%`;
}

function fillVoiceOptions(selected) {
  const sel = $('voice-name');
  if (!sel) return;
  const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const zh = voices.filter((v) => /^zh/i.test(v.lang) || /Chinese|Huihui|Yaoyao|Kangkang|Xiaoxiao/i.test(v.name));
  const keep = sel.value;
  sel.innerHTML = '<option value="">自动（优先中文女声）</option>';
  for (const v of zh) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} · ${v.lang}`;
    sel.appendChild(opt);
  }
  sel.value = selected != null ? selected : keep;
  if (sel.value !== (selected != null ? selected : keep)) sel.value = '';
}

async function loadSettings() {
  const s = await window.pet.getSettings();
  settingsCache = s;
  $('user-name').value = s.userName || '';
  $('pet-name').value = s.petName || '';
  $('api-base').value = s.apiBase || '';
  $('model').value = s.model || '';
  $('persona').value = s.persona || '';
  $('connection-state').textContent = s.hasApiKey ? 'DeepSeek 已连接' : '本地陪伴模式';

  paintSlider('pet-scale', 'pet-scale-val', s.petScale ?? 100);
  paintSlider('pet-opacity', 'pet-opacity-val', s.petOpacity ?? 100);
  $('line-frequency').value = s.lineFrequency || 'normal';

  $('voice-enabled').checked = s.voiceEnabled !== false;
  paintSlider('voice-rate', 'voice-rate-val', s.voiceRate ?? 100);
  paintSlider('voice-volume', 'voice-volume-val', s.voiceVolume ?? 85);
  fillVoiceOptions(s.voiceName || '');

  $('dnd-enabled').checked = !!s.dndEnabled;
  $('dnd-start').value = s.dndStart || '23:30';
  $('dnd-end').value = s.dndEnd || '08:00';
  $('dnd-allow').checked = s.dndAllowApproval !== false;
}

/* 外观类改动立刻预览，不写盘 */
function previewAppearance() {
  const scale = Number($('pet-scale').value) || 100;
  const opacity = Number($('pet-opacity').value) || 100;
  $('pet-scale-val').textContent = `${scale}%`;
  $('pet-opacity-val').textContent = `${opacity}%`;
  window.pet.previewAppearance({ petScale: scale, petOpacity: opacity });
}

function collectSettings() {
  return {
    userName: $('user-name').value,
    petName: $('pet-name').value,
    apiBase: $('api-base').value,
    model: $('model').value,
    persona: $('persona').value,
    apiKey: $('api-key').value,
    clearApiKey: $('clear-key').checked,
    petScale: Number($('pet-scale').value) || 100,
    petOpacity: Number($('pet-opacity').value) || 100,
    lineFrequency: $('line-frequency').value,
    voiceEnabled: $('voice-enabled').checked,
    voiceName: $('voice-name').value,
    voiceRate: Number($('voice-rate').value) || 100,
    voiceVolume: Number($('voice-volume').value),
    dndEnabled: $('dnd-enabled').checked,
    dndStart: $('dnd-start').value || '23:30',
    dndEnd: $('dnd-end').value || '08:00',
    dndAllowApproval: $('dnd-allow').checked
  };
}

async function send() {
  if (sending) return;
  const input = $('input');
  const text = input.value.trim();
  if (!text) return;
  sending = true;
  $('send').disabled = true;
  addMessage('user', text, Date.now());
  input.value = '';
  try {
    const result = await window.pet.sendHermesChat(text);
    if (result.ok) addMessage('assistant', result.answer, Date.now());
    else addMessage('assistant', result.error || '这条消息没有发出去。', Date.now());
  } catch (error) {
    addMessage('assistant', await addressed(error.message || '连接失败。'), Date.now());
  } finally {
    sending = false;
    $('send').disabled = false;
    input.focus();
  }
}

function showInspector(title, content, hint = '读取自 Hermes 本机目录') {
  $('inspector-title').textContent = title;
  $('inspector-hint').textContent = hint;
  $('inspector-content').innerHTML = content;
  $('inspector').classList.remove('hidden');
  $('setup').classList.add('hidden');
  $('task-modal').classList.add('hidden');
}

function openMemory() {
  window.pet.getMemory().then((data) => {
    const summaries = (data.archive?.recent || []).slice().reverse().map((row) => `
      <div><strong>${esc(row.day)}</strong> · ${Number(row.messageCount) || 0} 条消息
      <ul>${(row.userTopics || []).map((text) => `<li>${esc(text)}</li>`).join('')}</ul></div>`).join('');
    showInspector('Hermes 记忆', `
      <div class="data-block"><h3>用户画像</h3><pre>${esc(data.user || '暂无')}</pre></div>
      <div class="data-block"><h3>长期记忆（Hermes 主记忆）</h3><pre>${esc(data.longTerm || '暂无')}</pre></div>
      <div class="data-block"><h3>近 ${Number(data.archive?.midtermDays) || 14} 天会话摘要（自动摘录）</h3>${summaries || '<p>暂无桌宠会话归档</p>'}</div>`);
  });
}

function openSkills() {
  window.pet.getSkills().then((skills) => {
    const html = (skills || []).length
      ? skills.map((skill) => `<details><summary>${esc(skill.name)}</summary><pre>${esc(skill.content || '空技能')}</pre></details>`).join('')
      : '<div class="hint">Hermes 技能目录里还没有可读的 SKILL.md</div>';
    showInspector('Hermes 技能', html, '直接读取 Hermes 的 skills 目录，不另建一套技能系统');
  });
}

async function openTaskModal(files = []) {
  droppedFiles = files.filter(Boolean);
  const snapshot = await window.pet.getHermesSnapshot();
  const assignees = (snapshot.agents || []).map((agent) => agent.name);
  $('task-assignee').innerHTML = (assignees.length ? assignees : ['default'])
    .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  $('task-files').textContent = droppedFiles.length
    ? `附件：${droppedFiles.map((file) => file.name).join('、')}`
    : '没有附件，直接创建文字任务';
  if (!$('task-title').value && droppedFiles[0]) $('task-title').value = `处理：${droppedFiles[0].name}`;
  $('task-modal').classList.remove('hidden');
  $('inspector').classList.add('hidden');
  $('setup').classList.add('hidden');
  $('task-title').focus();
}

async function submitTask() {
  const title = $('task-title').value.trim();
  if (!title) {
    $('task-msg').textContent = '先写一个任务标题';
    return;
  }
  $('task-submit').disabled = true;
  $('task-msg').textContent = '正在创建任务…';
  try {
    const created = await window.pet.createTask({
      title,
      body: $('task-body').value.trim(),
      assignee: $('task-assignee').value || null,
      priority: Number($('task-priority').value)
    });
    if (!created.ok) throw new Error(created.error);
    const task = created.task && created.task.task;
    for (const file of droppedFiles) {
      if (!file.path) throw new Error(`无法读取附件路径：${file.name}`);
      const uploaded = await window.pet.uploadTaskFile(task.id, file.path);
      if (!uploaded.ok) throw new Error(uploaded.error);
    }
    $('task-msg').textContent = `已派发${droppedFiles.length ? `，上传 ${droppedFiles.length} 个附件` : ''}`;
    setTimeout(() => {
      $('task-modal').classList.add('hidden');
      $('task-title').value = '';
      $('task-body').value = '';
      droppedFiles = [];
    }, 900);
  } catch (error) {
    $('task-msg').textContent = error.message || '任务创建失败';
  } finally {
    $('task-submit').disabled = false;
  }
}

function setupVoice() {
  const Engine = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = $('voice-btn');
  if (!Engine) {
    button.title = '当前 Electron 没有可用的中文语音识别';
    button.addEventListener('click', async () => {
      $('task-msg').textContent = await addressed('当前环境没有语音识别入口，先用文字输入');
    });
    return;
  }
  recognition = new Engine();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onstart = () => {
    listening = true;
    button.classList.add('recording');
    button.textContent = '停';
    button.title = '停止听写';
  };
  recognition.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    if (text) $('input').value = text;
  };
  recognition.onerror = (event) => {
    $('input').placeholder = event.error === 'not-allowed' ? '麦克风权限被拒绝' : '语音识别失败，请改用文字';
  };
  recognition.onend = () => {
    listening = false;
    button.classList.remove('recording');
    button.textContent = '听';
    button.title = '中文语音输入';
  };
  button.addEventListener('click', () => {
    if (listening) recognition.stop();
    else recognition.start();
  });
}

async function init() {
  const history = await window.pet.getSessionHistory();
  if (history.entries && history.entries.length) history.entries.forEach((m) => addMessage(m.role, m.content, m.at));
  else addMessage('assistant', await addressed('Hermes 的 Bot Chat 目前还没有可显示的记录'), Date.now());
  await loadSettings();
  paintState(await window.pet.getState());
  $('input').focus();
  setupVoice();
}

$('send').addEventListener('click', send);
$('messages').addEventListener('click', (event) => {
  const button = event.target.closest('.read-message');
  if (!button) return;
  const text = button.parentElement.querySelector('.message-body')?.innerText || '';
  if (!text || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    $('input').placeholder = '当前系统没有可用的语音朗读';
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith('zh'));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
});
$('speak-btn').addEventListener('click', () => window.speechSynthesis?.cancel());
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('settings-btn').addEventListener('click', () => $('setup').classList.toggle('hidden'));
$('setup-close').addEventListener('click', () => $('setup').classList.add('hidden'));
$('inspector-close').addEventListener('click', () => $('inspector').classList.add('hidden'));
$('memory-btn').addEventListener('click', openMemory);
$('skills-btn').addEventListener('click', openSkills);
$('task-btn').addEventListener('click', () => openTaskModal());
$('task-cancel').addEventListener('click', () => $('task-modal').classList.add('hidden'));
$('task-submit').addEventListener('click', submitTask);
$('hide-btn').addEventListener('click', () => window.pet.hideChat());
$('close-btn').addEventListener('click', () => window.pet.closeChat());
$('save-settings').addEventListener('click', async () => {
  const saved = await window.pet.saveSettings(collectSettings());
  settingsCache = saved;
  $('api-key').value = '';
  $('clear-key').checked = false;
  $('setup-msg').textContent = saved.hasApiKey ? '已保存，下一条消息会走模型。' : '已保存，当前使用本地陪伴模式。';
  $('connection-state').textContent = saved.hasApiKey ? 'DeepSeek 已连接' : '本地陪伴模式';
  setTimeout(() => { $('setup-msg').textContent = ''; }, 2600);
});

/* 外观：拖动即预览 */
['pet-scale', 'pet-opacity'].forEach((id) => {
  $(id).addEventListener('input', previewAppearance);
  $(id).addEventListener('change', previewAppearance);
});
['voice-rate', 'voice-volume'].forEach((id) => {
  $(id).addEventListener('input', () => {
    $(id + '-val').textContent = `${$(id).value}%`;
  });
});

$('voice-enabled').addEventListener('change', () => {
  if (!$('voice-enabled').checked) {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
});

/* 试听：用当前面板上的音色/语速/音量，不写盘 */
$('voice-test').addEventListener('click', () => {
  if (!window.speechSynthesis) {
    $('setup-msg').textContent = '这台机器的运行环境没有语音合成能力。';
    return;
  }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('老板，语音就按这个音色念，觉得快慢合适就保存。');
    const name = $('voice-name').value;
    const voices = speechSynthesis.getVoices() || [];
    const chosen = voices.find((v) => v.name === name) || voices.find((v) => /^zh/i.test(v.lang));
    if (chosen) u.voice = chosen;
    u.lang = 'zh-CN';
    u.rate = (Number($('voice-rate').value) || 100) / 100;
    u.volume = Number($('voice-volume').value) / 100;
    speechSynthesis.speak(u);
    $('setup-msg').textContent = chosen ? `正在用「${chosen.name}」试听。` : '没找到中文语音包，改用默认音色试听。';
  } catch (e) {
    $('setup-msg').textContent = '试听失败：' + (e && e.message ? e.message : '未知错误');
  }
});

/* 恢复默认：只复位外观/语音/免打扰，不动 API 与人设 */
$('reset-settings').addEventListener('click', () => {
  paintSlider('pet-scale', 'pet-scale-val', 100);
  paintSlider('pet-opacity', 'pet-opacity-val', 100);
  paintSlider('voice-rate', 'voice-rate-val', 100);
  paintSlider('voice-volume', 'voice-volume-val', 85);
  $('line-frequency').value = 'normal';
  $('voice-enabled').checked = true;
  $('voice-name').value = '';
  $('dnd-enabled').checked = false;
  $('dnd-start').value = '23:30';
  $('dnd-end').value = '08:00';
  $('dnd-allow').checked = true;
  previewAppearance();
  $('setup-msg').textContent = '已恢复默认值，点「保存设置」生效。';
});

/* 语音列表是异步加载的，加载完再填一次 */
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = () => fillVoiceOptions($('voice-name').value);
}

/* 从 Hermes 的 .env 导入 DeepSeek 密钥 */
$('import-key').addEventListener('click', async () => {
  const r = await window.pet.importKey();
  if (r && r.ok) {
    $('setup-msg').textContent = `已从 Hermes 导入密钥（${r.keyLength} 位），地址 ${r.base}`;
    $('connection-state').textContent = 'DeepSeek 已连接';
    await loadSettings();
  } else {
    $('setup-msg').textContent = '导入失败：' + ((r && r.reason) || '未知原因');
  }
});

/* 从右键菜单进来时直接展开设置 */
window.pet.onOpenSettings(() => {
  $('setup').classList.remove('hidden');
  loadSettings();
});
window.pet.onState(paintState);
window.pet.onAnnounce((text) => addMessage('assistant', text, Date.now()));
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) openTaskModal(files);
});
init().catch(async (error) => addMessage('assistant', await addressed(error.message || '初始化失败。'), Date.now()));
