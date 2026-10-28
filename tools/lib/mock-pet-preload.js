/* 离线截图用的假 preload：桌宠页会调用 window.pet 的一堆接口，
 * 这里统一返回空对象，只为让渲染层能在没有主进程的情况下跑起来。 */
window.pet = new Proxy({}, {
  get: (target, key) => (key in target ? target[key] : async () => ({}))
});
