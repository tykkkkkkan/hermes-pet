const PANEL_MAX_PER_GROUP = 3;

function emptyTaskPanel() {
  return {
    running: { items: [], total: 0 },
    blocked: { items: [], total: 0 },
    review: { items: [], total: 0 },
    queued: { items: [], total: 0 },
    total: 0
  };
}

function taskTitle(task) {
  return String(task?.title || task?.name || `任务 #${task?.id ?? '?'}`).trim();
}

function slimTask(task) {
  return {
    id: task?.id ?? '',
    title: taskTitle(task),
    assignee: task?.assignee || '',
    status: task?.status || ''
  };
}

function packTaskGroup(list) {
  return {
    items: Array.isArray(list) ? list.slice(0, PANEL_MAX_PER_GROUP).map(slimTask) : [],
    total: Array.isArray(list) ? list.length : 0
  };
}

function buildTaskPanel(next = {}) {
  const allTasks = Array.isArray(next.tasks) ? next.tasks : [];
  const queued = allTasks.filter((task) => ['todo', 'ready', 'scheduled'].includes(String(task?.status || '').toLowerCase()));
  return {
    running: packTaskGroup(next.running),
    blocked: packTaskGroup(next.blocked),
    review: packTaskGroup(next.review),
    queued: packTaskGroup(queued),
    total: allTasks.length
  };
}

function clamp(value, fallback) {
  const number = Number(value);
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(number) ? number : fallback)));
}

function createDefaultState() {
  return {
    status: 'idle',
    statusText: '待命',
    hermesOnline: false,
    hermesText: 'Hermes 离线',
    runningCount: 0,
    queue: { todo: 0, ready: 0, scheduled: 0, running: 0, blocked: 0, review: 0, done: 0 },
    currentTask: null,
    agents: [],
    tasks: emptyTaskPanel(),
    emotion: '平静',
    address: '好大爹',
    affection: 50,
    mood: 72
  };
}

module.exports = function createPetState({ emotion, settingsStore, onChange } = {}) {
  if (!emotion) throw new Error('pet-state requires emotion');
  if (!settingsStore) throw new Error('pet-state requires settingsStore');
  let state = createDefaultState();
  const listeners = new Set();
  if (typeof onChange === 'function') listeners.add(onChange);

  function notify() {
    for (const listener of listeners) listener(state);
  }

  function replace(next, shouldNotify = true) {
    state = { ...createDefaultState(), ...next };
    state.affection = clamp(state.affection, 50);
    state.mood = clamp(state.mood, 72);
    if (shouldNotify) notify();
    return state;
  }

  function get() {
    return state;
  }

  function set(patch = {}) {
    return replace({ ...state, ...patch });
  }

  function applyEmotion(event) {
    return replace(emotion.applyEvent(state, event));
  }

  function decay(now = Date.now()) {
    let next = emotion.decay(state, now);
    const lastInteraction = Number(next.lastInteraction) || now;
    const lastIgnoredAt = Number(next.lastIgnoredAt) || 0;
    if (now - lastInteraction >= 6 * 3600000 && now - lastIgnoredAt >= 6 * 3600000) {
      next = emotion.applyEvent(next, 'ignored');
      next.lastIgnoredAt = now;
    }
    return replace(next);
  }

  function trackUserText(text) {
    const message = String(text || '');
    const next = { ...state, lastInteraction: Date.now(), lastIgnoredAt: 0 };
    if (/谢谢|辛苦|做得好|真棒|厉害|夸你/.test(message)) Object.assign(next, emotion.applyEvent(next, 'praised'));
    if (/催|快点|赶紧|怎么还没|进度呢/.test(message)) {
      const now = Date.now();
      const recentNagCount = Number(next.recentNagCount) || 0;
      const recentNagAt = Number(next.recentNagAt) || 0;
      next.recentNagCount = now - recentNagAt <= 10 * 60000 ? recentNagCount + 1 : 1;
      next.recentNagAt = now;
      if (next.recentNagCount >= 3) {
        Object.assign(next, emotion.applyEvent(next, 'nagged'));
        next.recentNagCount = 0;
      }
    }
    return replace(next);
  }

  function load() {
    const saved = settingsStore.readJson(settingsStore.stateFile(), {});
    const lastSeen = Number(saved.lastSeen) || Date.now();
    const hoursAway = Math.max(0, (Date.now() - lastSeen) / 3600000);
    return replace({
      status: 'idle',
      statusText: '待命',
      emotion: saved.emotion || '平静',
      emotionScores: saved.emotionScores || {},
      addressHistory: Array.isArray(saved.addressHistory) ? saved.addressHistory.slice(-2) : [],
      lastEmotionDecay: Number(saved.lastEmotionDecay) || lastSeen,
      lastInteraction: Number(saved.lastInteraction) || lastSeen,
      lastIgnoredAt: Number(saved.lastIgnoredAt) || 0,
      address: saved.address || '好大爹',
      affection: Math.max(0, Math.min(100, Number(saved.affection) || 50)),
      mood: Math.max(0, Math.min(100, (Number(saved.mood) || 72) - Math.min(24, Math.floor(hoursAway * 1.5))))
    });
  }

  function save() {
    decay();
    settingsStore.writeJson(settingsStore.stateFile(), {
      affection: state.affection,
      mood: state.mood,
      emotion: state.emotion,
      address: state.address,
      emotionScores: state.emotionScores,
      addressHistory: state.addressHistory,
      lastEmotionDecay: state.lastEmotionDecay,
      lastInteraction: state.lastInteraction,
      lastIgnoredAt: state.lastIgnoredAt,
      lastSeen: Date.now()
    });
    return state;
  }

  function adjust(affection = 0, mood = 0) {
    set({ affection: clamp(state.affection + affection, 50), mood: clamp(state.mood + mood, 72) });
    save();
    return state;
  }

  return {
    get, set, applyEmotion, decay, trackUserText, load, save,
    onChange: (fn) => {
      if (typeof fn === 'function') listeners.add(fn);
      return () => listeners.delete(fn);
    },
    adjust, buildTaskPanel, emptyTaskPanel, taskTitle
  };
};

module.exports.buildTaskPanel = buildTaskPanel;
module.exports.emptyTaskPanel = emptyTaskPanel;
