/* 右键菜单独立窗：放在桌宠窗口旁边，不再压在角色身上。
 * 语音 / 免打扰 / 大小三项可以直接在这里切，不必打开聊天窗。 */
(function () {
  const menu = document.getElementById('menu');
  const SCALES = [80, 100, 120];
  let cache = {};

  function paint(s) {
    cache = s || cache;
    const voiceOn = cache.voiceEnabled !== false;
    document.getElementById('st-voice').textContent = voiceOn ? '开' : '关';
    document.getElementById('st-voice').classList.toggle('off', !voiceOn);
    const dndOn = !!cache.dndEnabled;
    document.getElementById('st-dnd').textContent = dndOn ? '开' : '关';
    document.getElementById('st-dnd').classList.toggle('off', !dndOn);
    document.getElementById('st-scale').textContent = `${cache.petScale || 100}%`;
  }

  async function refresh() {
    try { paint(await window.pet.getSettings()); } catch { /* ignore */ }
  }

  async function toggle(field) {
    const s = await window.pet.getSettings();
    const next = {};
    if (field === 'voiceEnabled') next.voiceEnabled = !(s.voiceEnabled !== false);
    if (field === 'dndEnabled') next.dndEnabled = !s.dndEnabled;
    await window.pet.saveSettings(next);
    refresh();
  }

  async function cycleScale() {
    const s = await window.pet.getSettings();
    const cur = Number(s.petScale) || 100;
    const idx = SCALES.indexOf(cur);
    const next = SCALES[(idx + 1) % SCALES.length];
    await window.pet.saveSettings({ petScale: next });
    refresh();
  }

  function run(act) {
    switch (act) {
      case 'chat':
        window.pet.openChat();
        break;
      case 'talk':
        window.pet.menuAction('talk');
        break;
      case 'snap':
        window.pet.snapCorner();
        break;
      case 'voice':
        toggle('voiceEnabled');
        return;
      case 'dnd':
        toggle('dndEnabled');
        return;
      case 'scale':
        cycleScale();
        return;
      case 'top':
        window.pet.toggleTop();
        break;
      case 'autostart':
        window.pet.toggleAutostart();
        break;
      case 'settings':
        window.pet.openSettings();
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
    window.pet.closeMenu();
  }

  menu.addEventListener('click', (e) => {
    const mi = e.target.closest ? e.target.closest('.mi') : null;
    const act = mi && mi.dataset ? mi.dataset.act : null;
    if (act) run(act);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.pet.closeMenu();
  });

  refresh();
})();
