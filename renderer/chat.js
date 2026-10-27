const $ = (id) => document.getElementById(id);
let sending = false;

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
    <div class="message-body">${esc(text).replace(/\n/g, '<br />')}</div>`;
  $('messages').appendChild(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function paintState(state) {
  if (!state) return;
  $('mood').textContent = `心情 ${state.mood}/100 · 好感 ${state.affection}/100`;
  $('connection-state').textContent = state.statusText || '待命';
}

async function loadSettings() {
  const s = await window.pet.getSettings();
  $('user-name').value = s.userName || '';
  $('pet-name').value = s.petName || '';
  $('api-base').value = s.apiBase || '';
  $('model').value = s.model || '';
  $('persona').value = s.persona || '';
  $('connection-state').textContent = s.hasApiKey ? 'DeepSeek 已连接' : '本地陪伴模式';
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
    const result = await window.pet.sendChat(text);
    if (result.ok) addMessage('assistant', result.answer, Date.now());
    else addMessage('assistant', result.error || '这条消息没有发出去。', Date.now());
  } catch (error) {
    addMessage('assistant', error.message || '连接失败。', Date.now());
  } finally {
    sending = false;
    $('send').disabled = false;
    input.focus();
  }
}

async function init() {
  const history = await window.pet.getHistory();
  if (history.length) history.forEach((m) => addMessage(m.role, m.content, m.at));
  else addMessage('assistant', '我上线了。先用本地模式陪你，接入 DeepSeek 后我会保留这段对话。', Date.now());
  await loadSettings();
  paintState(await window.pet.getState());
  $('input').focus();
}

$('send').addEventListener('click', send);
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('settings-btn').addEventListener('click', () => $('setup').classList.toggle('hidden'));
$('setup-close').addEventListener('click', () => $('setup').classList.add('hidden'));
$('hide-btn').addEventListener('click', () => window.pet.hideChat());
$('close-btn').addEventListener('click', () => window.pet.closeChat());
$('save-settings').addEventListener('click', async () => {
  const saved = await window.pet.saveSettings({
    userName: $('user-name').value,
    petName: $('pet-name').value,
    apiBase: $('api-base').value,
    model: $('model').value,
    persona: $('persona').value,
    apiKey: $('api-key').value,
    clearApiKey: $('clear-key').checked
  });
  $('api-key').value = '';
  $('clear-key').checked = false;
  $('setup-msg').textContent = saved.hasApiKey ? '设置已保存，下一条消息会走模型。' : '设置已保存，当前使用本地陪伴模式。';
  $('connection-state').textContent = saved.hasApiKey ? 'DeepSeek 已连接' : '本地陪伴模式';
});
window.pet.onState(paintState);
init().catch((error) => addMessage('assistant', error.message || '初始化失败。', Date.now()));
