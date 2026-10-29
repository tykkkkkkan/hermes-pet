const $ = (id) => document.getElementById(id);
let sending = false;
let droppedFiles = [];
let recognition = null;
let listening = false;
let lastDayKey = '';
let typingEl = null;
let settingsCache = {};
let streamRow = null;
let streamText = '';

async function addressed(text) {
  return window.pet.formatUtterance(text).catch(() => String(text || ''));
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

/* 极轻的 markdown 渲染：Hermes 的回复里代码块和列表很常见，
 * 以前一律 esc + <br>，代码会糊成一片。这里只认最必要的四种语法，
 * 先切代码块占位、再整体转义，保证不会把标签当 HTML 执行。 */
function renderMarkdown(text) {
  const blocks = [];
  let src = String(text == null ? '' : text).replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') });
    return `\u0000${blocks.length - 1}\u0000`;
  });

  src = esc(src)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<)）]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');

  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const want = bullet ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${(bullet || ordered)[1]}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { out.push(line.trim()); continue; }
    out.push(`<p>${line}</p>`);
  }
  closeList();

  let html = out.join('');
  html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => {
    const b = blocks[Number(i)];
    if (!b) return '';
    return `<pre><code>${esc(b.code)}</code></pre>`;
  });
  return html || '<p></p>';
}

function nearBottom() {
  const box = $('messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
}

function scrollToEnd(force = true) {
  const box = $('messages');
  if (force || nearBottom()) box.scrollTop = box.scrollHeight;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(date) {
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(date.toDateString())) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff} 天前`;
  return date.toLocaleDateString([], { month: 'long', day: 'numeric' });
}

function appendDaySep(date) {
  const key = dayKey(date);
  if (key === lastDayKey) return;
  lastDayKey = key;
  const sep = document.createElement('div');
  sep.className = 'day-sep';
  sep.textContent = dayLabel(date);
  $('messages').appendChild(sep);
}

function hideWelcome() {
  const w = $('welcome');
  if (w) w.classList.add('hidden');
}

function addMessage(role, text, at) {
  hideWelcome();
  const time = at ? new Date(at) : new Date();
  appendDaySep(time);

  const mine = role === 'user';
  const row = document.createElement('article');
  row.className = `message ${mine ? 'mine' : 'hers'}`;
  row.innerHTML = `
    ${mine ? '' : '<img class="message-avatar" src="../assets/ui/avatar.png" alt="" />'}
    <div class="bubble-wrap">
      <div class="message-meta">${mine ? '你' : 'Hermes'} · ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="message-body">${renderMarkdown(text)}</div>
      <div class="message-tools">
        <button class="act-copy" type="button">复制</button>
        ${mine ? '' : '<button class="act-read" type="button">朗读</button>'}
      </div>
    </div>`;
  $('messages').appendChild(row);
  scrollToEnd();
  return row;
}

function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement('article');
  typingEl.className = 'message hers typing';
  typingEl.innerHTML = `
    <img class="message-avatar" src="../assets/ui/avatar.png" alt="" />
    <div class="bubble-wrap">
      <div class="message-body"><span></span><span></span><span></span></div>
    </div>`;
  $('messages').appendChild(typingEl);
  scrollToEnd();
}

function hideTyping() {
  if (typingEl) typingEl.remove();
  typingEl = null;
}

function paintState(state) {
  if (!state) return;
  const mood = Number(state.mood);
  const affection = Number(state.affection);
  $('mood').textContent =
    `心情 ${Number.isFinite(mood) ? mood : '--'}/100 · 好感 ${Number.isFinite(affection) ? affection : '--'}/100`;

  const online = !!state.hermesOnline;
  const running = Number(state.runningCount) || 0;
  const pill = $('status-pill');
  const text = $('status-text');
  if (pill && text) {
    pill.dataset.state = !online ? 'off' : running ? 'busy' : 'on';
    text.textContent = !online ? 'Hermes 离线' : running ? `在线 · ${running} 个在跑` : '在线 · 空闲';
    pill.title = state.hermesText || '';
  }
}

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

async function send(textOverride) {
  if (sending) return;
  const input = $('input');
  const text = String(textOverride != null ? textOverride : input.value).trim();
  if (!text) return;

  sending = true;
  streamRow = null;
  streamText = '';
  $('send').disabled = true;
  addMessage('user', text, Date.now());
  input.value = '';
  growInput();
  showTyping();

  try {
    const result = await window.pet.sendHermesChat(text);
    hideTyping();
    if (result.ok) {
      if (streamRow) {
        // 流式那一条已经点出来了，用最终文本收口（避免和增量拼出来的有细微差异）
        const body = streamRow.querySelector('.message-body');
        if (body) body.innerHTML = renderMarkdown(result.answer);
        streamRow.classList.remove('streaming');
        scrollToEnd();
      } else {
        addMessage('assistant', result.answer, Date.now());
      }
    } else {
      if (streamRow && !streamText.trim()) {
        streamRow.remove();
        streamRow = null;
      }
      addMessage('assistant', result.error || '这条消息没有发出去。', Date.now());
    }
  } catch (error) {
    hideTyping();
    if (streamRow && !streamText.trim()) { streamRow.remove(); streamRow = null; }
    addMessage('assistant', await addressed(error.message || '连接失败。'), Date.now());
  } finally {
    if (streamRow) streamRow.classList.remove('streaming');
    streamRow = null;
    streamText = '';
    sending = false;
    $('send').disabled = false;
    input.focus();
  }
}

/* ------------------------------- 面板与遮罩 ------------------------------- */
function showScrim() { $('scrim').classList.remove('hidden'); }
function hideScrim() { $('scrim').classList.add('hidden'); }

function closePanels() {
  for (const id of ['setup', 'inspector', 'task-modal']) $(id).classList.add('hidden');
  hideScrim();
}

function openPanel(id) {
  for (const other of ['setup', 'inspector', 'task-modal']) {
    if (other !== id) $(other).classList.add('hidden');
  }
  $(id).classList.remove('hidden');
  showScrim();
}

function showInspector(title, content, hint = '读取自 Hermes 本机目录') {
  $('inspector-title').textContent = title;
  $('inspector-hint').textContent = hint;
  $('inspector-content').innerHTML = content;
  openPanel('inspector');
}

function openMemory() {
  window.pet.getMemory().then((data) => {
    const summaries = (data.archive?.recent || []).slice().reverse().map((row) => `
      <div><strong>${esc(row.day)}</strong> · ${Number(row.messageCount) || 0} 条消息
      <ul>${(row.userTopics || []).map((text) => `<li>${esc(text)}</li>`).join('')}</ul></div>`).join('');
    showInspector('Hermes 记忆', `
      <div class="data-block"><h3>用户画像</h3><pre>${esc(data.user || '暂无')}</pre></div>
      <div class="data-block"><h3>长期记忆（Hermes 主记忆）</h3><pre>${esc(data.longTerm || '暂无')}</pre></div>
      <div class="data-block"><h3>近 ${Number(data.archive?.midtermDays) || 14} 天会话摘要（自动摘录）</h3>${summaries || '<p class="hint">暂无桌宠会话归档</p>'}</div>`);
  });
}

function openSkills() {
  window.pet.getSkills().then((skills) => {
    const html = (skills || []).length
      ? skills.map((skill) => `<details><summary>${esc(skill.name)}</summary><pre>${esc(skill.content || '空技能')}</pre></details>`).join('')
      : '<p class="hint">Hermes 技能目录里还没有可读的 SKILL.md</p>';
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
  openPanel('task-modal');
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
      closePanels();
      $('task-title').value = '';
      $('task-body').value = '';
      $('task-msg').textContent = '';
      droppedFiles = [];
    }, 900);
  } catch (error) {
    $('task-msg').textContent = error.message || '任务创建失败';
  } finally {
    $('task-submit').disabled = false;
  }
}

/* --------------------------------- 语音输入 -------------------------------- */
function setupVoice() {
  const Engine = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = $('voice-btn');
  if (!Engine) {
    window.pet.log('warn', '[asr] unavailable');
    button.title = '当前 Electron 没有可用的中文语音识别';
    button.addEventListener('click', () => {
      $('input').placeholder = '当前环境没有语音识别入口，先用文字输入';
    });
    return;
  }
  recognition = new Engine();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = true;
  let gotAudio = false;
  let responseTimer = null;
  const clearResponseTimer = () => {
    clearTimeout(responseTimer);
    responseTimer = null;
  };
  const preview = (text) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return Array.from(value).slice(0, 20).join('') + (Array.from(value).length > 20 ? '…' : '');
  };
  recognition.onstart = () => {
    gotAudio = false;
    clearResponseTimer();
    responseTimer = setTimeout(() => {
      if (!gotAudio && listening) {
        window.pet.log('warn', '[asr] timeout: no audio within 5s');
        $('input').placeholder = '语音服务没有响应：麦克风没采到声音，或系统没有可用的中文识别';
      }
    }, 5000);
    window.pet.log('info', '[asr] start');
    listening = true;
    button.classList.add('recording');
    button.title = '正在听… 点一下停止';
  };
  recognition.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    if (text) {
      window.pet.log('info', '[asr] result', preview(text));
      $('input').value = text;
      growInput();
    }
  };
  recognition.onaudiostart = () => {
    gotAudio = true;
    window.pet.log('info', '[asr] audiostart');
  };
  recognition.onaudioend = () => window.pet.log('info', '[asr] audioend');
  recognition.onspeechend = () => window.pet.log('info', '[asr] speechend');
  recognition.onerror = (event) => {
    clearResponseTimer();
    window.pet.log('warn', '[asr] error', event.error || 'unknown');
    $('input').placeholder = event.error === 'not-allowed' ? '麦克风权限被拒绝' : '语音识别失败，请改用文字';
  };
  recognition.onend = () => {
    clearResponseTimer();
    window.pet.log('info', '[asr] end', gotAudio ? 'audio=1' : 'audio=0');
    if (!gotAudio) $('input').placeholder = '语音服务没有响应：麦克风没采到声音，或系统没有可用的中文识别';
    listening = false;
    button.classList.remove('recording');
    button.title = '中文语音输入';
  };
  button.addEventListener('click', () => {
    if (listening) recognition.stop();
    else recognition.start();
  });
}

/* --------------------------------- 朗读/复制 ------------------------------- */
function readAloud(text) {
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
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    area.remove();
  }
  if (button) {
    const old = button.textContent;
    button.textContent = '已复制';
    setTimeout(() => { button.textContent = old; }, 1200);
  }
}

/* --------------------------------- 输入框自适应 ---------------------------- */
function growInput() {
  const el = $('input');
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
}

/* -------------------------------- 事件绑定 -------------------------------- */
$('send').addEventListener('click', () => send());

$('messages').addEventListener('click', (event) => {
  const readBtn = event.target.closest('.act-read');
  if (readBtn) {
    const text = readBtn.closest('.bubble-wrap')?.querySelector('.message-body')?.innerText || '';
    readAloud(text);
    return;
  }
  const copyBtn = event.target.closest('.act-copy');
  if (copyBtn) {
    const text = copyBtn.closest('.bubble-wrap')?.querySelector('.message-body')?.innerText || '';
    copyText(text, copyBtn);
  }
});

$('speak-btn').addEventListener('click', () => window.speechSynthesis?.cancel());

$('input').addEventListener('input', growInput);
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

$('settings-btn').addEventListener('click', () => {
  if ($('setup').classList.contains('hidden')) { openPanel('setup'); loadSettings(); }
  else closePanels();
});
$('setup-close').addEventListener('click', closePanels);
$('inspector-close').addEventListener('click', closePanels);
$('task-cancel').addEventListener('click', closePanels);
$('scrim').addEventListener('click', closePanels);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanels(); });

$('memory-btn').addEventListener('click', openMemory);
$('skills-btn').addEventListener('click', openSkills);
$('task-btn').addEventListener('click', () => openTaskModal());
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

/* 空态快捷入口 */
document.querySelectorAll('.quick button').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.act === 'task') return openTaskModal();
    send(button.dataset.ask || '');
  });
});

/* 从右键菜单进来时直接展开设置 */
window.pet.onOpenSettings(() => {
  openPanel('setup');
  loadSettings();
});
window.pet.onState(paintState);
window.pet.onAnnounce((text) => addMessage('assistant', text, Date.now()));

/* Hermes 是边说边生成的：第一个增量到达才把「正在输入」换成真气泡，之后逐段追加 */
window.pet.onChatDelta((delta) => {
  if (!sending || !delta) return;
  if (!streamRow) {
    hideTyping();
    streamRow = addMessage('assistant', '', Date.now());
    streamRow.classList.add('streaming');
  }
  streamText += delta;
  const body = streamRow.querySelector('.message-body');
  if (body) body.innerHTML = renderMarkdown(streamText);
  scrollToEnd();
});

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) openTaskModal(files);
});

async function init() {
  const history = await window.pet.getSessionHistory();
  const entries = (history.entries || []).filter((m) => m && m.content);
  if (entries.length) entries.forEach((m) => addMessage(m.role, m.content, m.at));
  await loadSettings();
  paintState(await window.pet.getState());
  growInput();
  $('input').focus();
  setupVoice();
}

init().catch(async (error) => addMessage('assistant', await addressed(error.message || '初始化失败。'), Date.now()));
