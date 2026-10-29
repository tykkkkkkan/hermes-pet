const fs = require('fs');
const path = require('path');

function savePng(target, image, label) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, image.toPNG());
    console.log(`${label} saved`);
  } catch (error) {
    console.log(`${label} failed:`, error.message);
  }
}

function createLive2dTestWindow({ BrowserWindow, root }) {
  const testWin = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Live2D 技术验证',
    backgroundColor: '#15161c',
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  testWin.loadURL('petasset://app/renderer/live2d-test.html');
  testWin.webContents.on('console-message', (...args) => {
    const first = args[0];
    const message = first && typeof first === 'object' && 'message' in first ? first.message : args[2];
    console.log('[live2d-test]', message);
  });
  if (process.env.PET_LIVE2D_SHOT) {
    const delay = Number(process.env.PET_LIVE2D_SHOT) || 6000;
    setTimeout(async () => savePng(path.join(root, 'live2d-test.png'), await testWin.capturePage(), 'live2d shot'), delay);
  }
  return testWin;
}

module.exports = function runDevSelfcheck({ win, petState, showChat, openMenuWindow, getChatWin, getMenuWin, BrowserWindow, root }) {
  if (process.env.PET_APPEARANCE_TEST) {
    setTimeout(async () => {
      console.log('appearance before:', JSON.stringify(win.getBounds()));
      await win.webContents.executeJavaScript('window.pet.previewAppearance({ petScale: 80, petOpacity: 65 })').catch(() => {});
      setTimeout(async () => {
        console.log('appearance after:', JSON.stringify(win.getBounds()));
        savePng(path.join(root, '.tmp', 'appearance-shot.png'), await win.capturePage(), 'appearance shot');
      }, 900);
    }, 3500);
  }
  if (process.env.PET_SETTINGS_TEST) {
    setTimeout(() => {
      showChat();
      setTimeout(() => {
        const chatWin = getChatWin();
        if (!chatWin || chatWin.isDestroyed()) return;
        chatWin.webContents.send('open-settings');
        setTimeout(async () => savePng(path.join(root, '.tmp', 'settings-shot.png'), await chatWin.capturePage(), 'settings shot'), 1200);
      }, 1600);
    }, 3000);
  }
  if (process.env.PET_MENU_TEST) {
    setTimeout(async () => {
      openMenuWindow();
      setTimeout(async () => {
        try {
          const menuWin = getMenuWin();
          if (menuWin && !menuWin.isDestroyed()) {
            savePng(path.join(root, '.tmp', 'menu-shot.png'), await menuWin.capturePage(), 'menu shot');
            console.log('menu shot saved, pos:', JSON.stringify(menuWin.getPosition()));
          }
        } catch (error) { console.log('menu shot failed:', error.message); }
      }, 1300);
    }, 3200);
  }
  if (process.env.PET_TTS_PROBE) {
    setTimeout(async () => {
      const script = `new Promise(function(res){
        function read(){
          try { return speechSynthesis.getVoices().map(function(v){ return v.name + ' | ' + v.lang + ' | local=' + v.localService; }); }
          catch (e) { return ['ERR:' + e.message]; }
        }
        var v = read();
        if (v.length) return res(v);
        speechSynthesis.onvoiceschanged = function(){ res(read()); };
        setTimeout(function(){ res(read()); }, 1800);
      })`;
      try { console.log('tts voices:', JSON.stringify(await win.webContents.executeJavaScript(script))); }
      catch (error) { console.log('tts probe failed:', error.message); }
    }, 2600);
  }
  if (process.env.PET_HOVER_TEST) {
    setTimeout(() => {
      const script = `(function(){
        var a = document.getElementById('pet-hit-area').getBoundingClientRect();
        var x = a.left + a.width * 0.5;
        var y = a.top + a.height * 0.12;
        function fire(){ window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true })); }
        fire(); setTimeout(fire, 620); setTimeout(fire, 900); return 'hover-injected';
      })()`;
      win.webContents.executeJavaScript(script).then((result) => console.log('hover test:', result)).catch(() => {});
    }, 3000);
  }
  if (process.env.PET_DRAG_TEST) {
    setTimeout(async () => {
      const probe = `(function(){
        var c = document.querySelector('#pet-live2d-host canvas');
        var r = c ? c.getBoundingClientRect() : null;
        var pet = document.getElementById('pet');
        return { iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio,
          canvasCss: r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'none',
          canvasPx: c ? c.width + 'x' + c.height : 'none',
          petTransform: pet ? getComputedStyle(pet).transform : 'none',
          anim: pet ? getComputedStyle(pet).animationName : 'none',
          animState: pet ? getComputedStyle(pet).animationPlayState : 'none', classes: pet ? pet.className : '' };
      })()`;
      const before = await win.webContents.executeJavaScript(probe);
      const startBounds = win.getBounds();
      console.log('drag[0] before:', JSON.stringify(before), 'bounds:', JSON.stringify(startBounds), 'pos:', JSON.stringify(win.getPosition()));
      await win.webContents.executeJavaScript('window.pet.dragBegin()');
      for (let i = 1; i <= 40; i++) {
        win.webContents.executeJavaScript('window.pet.dragMove()').catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 55));
        if (i % 10 === 0) console.log(`drag[${i}] bounds:`, JSON.stringify(win.getBounds()), 'pos:', JSON.stringify(win.getPosition()));
      }
      await win.webContents.executeJavaScript('window.pet.dragEnd()');
      const after = await win.webContents.executeJavaScript(probe);
      console.log('drag[40] after:', JSON.stringify(after), 'bounds:', JSON.stringify(win.getBounds()), 'pos:', JSON.stringify(win.getPosition()));
      savePng(path.join(root, '.tmp', 'drag-shot.png'), await win.capturePage(), 'drag shot');
    }, 3600);
  }
  if (process.env.PET_SHOT) {
    if (process.env.PET_STATE_TEST) {
      setTimeout(() => {
        const script = `(function(){
          if (!window.petLive2d) return 'missing';
          var s = ${JSON.stringify(process.env.PET_STATE_TEST)};
          window.petLive2d.setState(s); clearInterval(window.__stateTestTimer);
          window.__stateTestTimer = setInterval(function(){ window.petLive2d.setState(s); }, 250); return 'ok';
        })()`;
        win.webContents.executeJavaScript(script).then((result) => console.log('state test:', result)).catch(() => {});
      }, 4200);
    }
    const delay = Number(process.env.PET_SHOT_DELAY) || 2600;
    setTimeout(async () => savePng(path.join(root, 'shot.png'), await win.capturePage(), 'shot'), delay);
  }
  if (process.env.PET_LIVE2D_TEST === '1') createLive2dTestWindow({ BrowserWindow, root });
};
