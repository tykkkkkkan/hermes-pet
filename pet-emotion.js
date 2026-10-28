const MOODS = [
  { name: '平静', weight: 30 },
  { name: '开心', weight: 20 },
  { name: '得意', weight: 12 },
  { name: '犯困', weight: 10 },
  { name: '有点烦', weight: 10 },
  { name: '闹别扭', weight: 8 },
  { name: '委屈', weight: 6 },
  { name: '兴奋', weight: 4 }
];

const EVENT_MOODS = {
  success: ['得意', 2],
  failure: ['有点烦', 1],
  touched: ['开心', 1],
  nagged: ['闹别扭', 2],
  praised: ['得意', 1],
  working: ['兴奋', 1],
  ignored: ['委屈', 2]
};

function scoresOf(state = {}) {
  const scores = state.emotionScores && typeof state.emotionScores === 'object'
    ? { ...state.emotionScores }
    : {};
  for (const { name } of MOODS) scores[name] = Math.max(0, Number(scores[name]) || 0);
  return scores;
}

function emotionFromScores(scores, random = Math.random) {
  const active = MOODS.filter(({ name }) => name !== '平静' && scores[name] > 0);
  if (!active.length) {
    const total = MOODS.reduce((sum, mood) => sum + mood.weight, 0);
    let pick = random() * total;
    return MOODS.find(({ weight }) => (pick -= weight) < 0)?.name || '平静';
  }
  return active.reduce((best, mood) => scores[mood.name] > scores[best.name] ? mood : best).name;
}

function applyEvent(state = {}, event, random = Math.random) {
  const next = { ...state, emotionScores: scoresOf(state) };
  const entry = EVENT_MOODS[event];
  if (!entry) return next;
  const [mood, amount] = entry;
  next.emotionScores[mood] = Math.min(24, next.emotionScores[mood] + amount);
  next.emotion = emotionFromScores(next.emotionScores, random);
  return next;
}

function decay(state = {}, now = Date.now(), random = Math.random) {
  const next = { ...state, emotionScores: scoresOf(state) };
  const last = Number(state.lastEmotionDecay) || now;
  const elapsedHours = Math.floor(Math.max(0, now - last) / 3600000);
  if (!elapsedHours) return next;
  for (const mood of Object.keys(next.emotionScores)) {
    if (mood !== '平静') next.emotionScores[mood] = Math.max(0, next.emotionScores[mood] - elapsedHours);
  }
  next.lastEmotionDecay = last + elapsedHours * 3600000;
  next.emotion = emotionFromScores(next.emotionScores, random);
  return next;
}

function chooseAddress(emotion, current, pool = [], history = [], random = Math.random) {
  const valid = pool.filter((item) => item && typeof item.word === 'string' && item.word.trim());
  if (!valid.length) return current || '好大爹';
  const recent = history.slice(-2);
  const preferred = {
    '闹别扭': '小朋友',
    '委屈': '板板',
    '得意': '老板',
    '有点烦': '汤伊轲'
  }[emotion];
  const mustSwitch = recent.length === 2 && recent[0] === recent[1] && recent[0] === current;
  const canSwitch = mustSwitch || random() < 0.3;
  const candidates = valid.filter(({ word }) => word !== current && recent.filter((item) => item === word).length < 2);
  if (!canSwitch || !candidates.length) return current || valid[0].word;
  const favored = candidates.find(({ word }) => word === preferred);
  const weighted = favored && random() < 0.65 ? [favored] : candidates;
  const total = weighted.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (!total) return weighted[0].word;
  let pick = random() * total;
  return (weighted.find((item) => (pick -= Math.max(0, Number(item.weight) || 0)) < 0) || weighted.at(-1)).word;
}

module.exports = { MOODS, applyEvent, decay, emotionFromScores, chooseAddress };
