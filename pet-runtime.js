function isQuietHours(date = new Date()) {
  const hour = date.getHours();
  return hour >= 1 && hour < 8;
}

function isFailureStatus(status) {
  return ['blocked', 'failed', 'error'].includes(String(status || '').toLowerCase());
}

function shouldAnnounce({ date = new Date(), taskResult = false, userInitiated = false } = {}) {
  return !isQuietHours(date) || taskResult || userInitiated;
}

function normalizeSnapshot(snapshot = {}, checkedAt = Date.now()) {
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const byStatus = (status) => tasks.filter((task) => String(task?.status || '').toLowerCase() === status);
  const running = Array.isArray(snapshot.running) ? snapshot.running : byStatus('running');
  const blocked = Array.isArray(snapshot.blocked) ? snapshot.blocked : byStatus('blocked');
  const review = Array.isArray(snapshot.review) ? snapshot.review : byStatus('review');
  const sourceCounts = snapshot.counts && typeof snapshot.counts === 'object' ? snapshot.counts : {};
  const counts = Object.fromEntries(
    ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done']
      .map((key) => [key, Math.max(0, Number(sourceCounts[key]) || 0)])
  );
  return {
    ...snapshot,
    online: snapshot.online === true,
    tasks,
    running,
    blocked,
    review,
    counts,
    agents: Array.isArray(snapshot.agents) ? snapshot.agents : [],
    currentTask: snapshot.currentTask || null,
    checkedAt: Number(snapshot.checkedAt) || checkedAt
  };
}

function deriveStatus(snapshot, { now = Date.now(), successUntil = 0 } = {}) {
  const state = normalizeSnapshot(snapshot, now);
  if (!state.online) return { status: 'idle', statusText: '待命（Hermes 离线）', face: 'idle' };
  const failedTasks = state.tasks.filter((task) => isFailureStatus(task.status));
  if (state.blocked.length || failedTasks.length) {
    const severe = failedTasks.some((task) => ['failed', 'error'].includes(String(task.status).toLowerCase()));
    return { status: 'error', statusText: '有任务受阻或失败', face: severe ? 'cry' : 'angry' };
  }
  if (state.running.length) return { status: 'working', statusText: '执行中', face: 'thinking' };
  if (state.gatewayBusy) return { status: 'thinking', statusText: '思考中', face: 'thinking' };
  if (successUntil > now) return { status: 'success', statusText: '刚刚完成', face: 'happy' };
  if (state.review.length) return { status: 'success', statusText: '待验收', face: 'happy' };
  const hour = new Date(now).getHours();
  if (hour >= 1 && hour < 8) return { status: 'sleep', statusText: '休眠', face: 'sleepy' };
  return { status: 'idle', statusText: '待命', face: 'idle' };
}

function taskTransitions(previous, next) {
  const before = new Map((previous?.tasks || []).filter((task) => task?.id != null)
    .map((task) => [String(task.id), task]));
  return (next?.tasks || []).flatMap((task) => {
    if (task?.id == null) return [];
    const old = before.get(String(task.id));
    if (!old || old.status === task.status) return [];
    if (task.status === 'done' || isFailureStatus(task.status)) return [{ previous: old, task }];
    return [];
  });
}

module.exports = {
  isQuietHours, isFailureStatus, shouldAnnounce,
  normalizeSnapshot, deriveStatus, taskTransitions
};
