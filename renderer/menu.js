/* 右键菜单独立窗：放在桌宠窗口旁边，不再压在角色身上。 */
(function () {
  const menu = document.getElementById('menu');

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
    const act = e.target && e.target.dataset ? e.target.dataset.act : null;
    if (act) run(act);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.pet.closeMenu();
  });
})();
