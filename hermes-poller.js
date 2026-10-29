const defaultRuntime = require('./pet-runtime');

module.exports = function createHermesPoller({
  bridge,
  state,
  announce,
  pushState,
  taskTitle,
  runtime = defaultRuntime,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  baseInterval = 3000,
  backoffInterval = 15000
} = {}) {
  if (!bridge || !state) throw new Error('hermes-poller requires bridge and state');
  let timer = null;
  let pollInFlight = false;
  let previous = null;
  let successUntil = 0;
  let consecutiveFailures = 0;
  let interval = baseInterval;

  function statusFromSnapshot(snapshot) {
    const normalized = runtime.normalizeSnapshot(snapshot, now());
    return {
      ...runtime.deriveStatus(normalized, { now: now(), successUntil }),
      runningCount: normalized.running.length
    };
  }

  function reviewTransitions(previousSnapshot, next) {
    const before = new Map((previousSnapshot?.tasks || []).filter((task) => task?.id != null)
      .map((task) => [String(task.id), task]));
    return (next?.tasks || []).filter((task) => task?.id != null
      && String(task.status || '').toLowerCase() === 'review'
      && String(before.get(String(task.id))?.status || '').toLowerCase() !== 'review');
  }

  function applySnapshot(snapshot) {
    const next = runtime.normalizeSnapshot(snapshot);
    const transitions = runtime.taskTransitions(previous, next);
    const reviews = reviewTransitions(previous, next);
    if (previous) {
      if (transitions.some(({ task }) => task.status === 'done')) successUntil = now() + 4500;
      if (transitions.some(({ task }) => runtime.isFailureStatus(task.status))) successUntil = 0;
    }
    const stateChange = statusFromSnapshot(next);
    const current = state.get();
    const statusChanged = !previous || stateChange.status !== current.status;
    state.decay();
    state.set({
      ...stateChange,
      hermesOnline: !!next.online,
      gatewayBusy: !!next.gatewayBusy,
      hermesText: next.online ? `在线 · ${next.running.length} 个在跑` : 'Hermes 离线',
      runningCount: next.running.length,
      queue: next.counts,
      currentTask: next.currentTask ? {
        id: next.currentTask.id,
        title: taskTitle(next.currentTask),
        assignee: next.currentTask.assignee || ''
      } : null,
      agents: next.agents,
      tasks: state.buildTaskPanel(next)
    });
    if (statusChanged && (next.running || []).length) state.applyEmotion('working');
    pushState();
    if (previous) {
      for (const { task } of transitions) {
        if (task.status === 'done') {
          state.applyEmotion('success');
          state.set({ mood: Math.min(100, state.get().mood + 2) });
          announce(`{address}，${taskTitle(task)} 完成了，验收一下`, { notify: true, kind: 'success', taskResult: true });
        } else if (runtime.isFailureStatus(task.status)) {
          state.applyEmotion('failure');
          state.set({ mood: Math.max(0, state.get().mood - 1) });
          const resultWord = task.status === 'blocked' ? '受阻' : '失败';
          announce(`{address}，${taskTitle(task)} ${resultWord}了。先别急，我把问题盯住`, { notify: true, kind: 'error', taskResult: true });
        }
      }
      for (const task of reviews) {
        state.applyEmotion('success');
        state.set({ mood: Math.min(100, state.get().mood + 1) });
        announce(`{address}，${taskTitle(task)} 做完了，等你验收`, { notify: true, kind: 'success', taskResult: true });
      }
      if (previous.online && !next.online) {
        announce('{address}，Hermes 服务断了，我先安静等它回来', { notify: true, kind: 'error' });
      } else if (!previous.online && next.online) {
        announce('{address}，Hermes 回来了，现在在线', { notify: false, kind: 'success' });
      }
    }
    previous = next;
    state.save();
    return next;
  }

  async function poll() {
    if (pollInFlight) return false;
    pollInFlight = true;
    try {
      applySnapshot(await bridge.snapshot());
      consecutiveFailures = 0;
      interval = baseInterval;
      return true;
    } catch {
      consecutiveFailures += 1;
      applySnapshot({ online: false });
      interval = consecutiveFailures >= 3 ? backoffInterval : baseInterval;
      return false;
    } finally {
      pollInFlight = false;
    }
  }

  function schedule() {
    clearTimer(timer);
    timer = setTimer(async () => {
      await poll();
      schedule();
    }, interval);
    return interval;
  }

  function start() {
    stop();
    poll().finally(schedule);
  }

  function stop() {
    clearTimer(timer);
    timer = null;
  }

  return {
    statusFromSnapshot,
    reviewTransitions,
    applySnapshot,
    poll,
    start,
    stop,
    getInterval: () => interval,
    getPrevious: () => previous
  };
};
