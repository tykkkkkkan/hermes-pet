const MOOD_KEYS = {
  '开心': 'happy', '得意': 'happy', '兴奋': 'happy',
  '犯困': 'tired',
  '有点烦': 'sulky', '闹别扭': 'sulky', '委屈': 'sulky'
};

function touchPoolKey(emotion, mood) {
  const key = MOOD_KEYS[String(emotion || '')];
  if (key) return key;
  const value = Number(mood) || 0;
  if (value >= 78) return 'happy';
  if (value <= 30) return 'sulky';
  return 'normal';
}

function createTouchPicker(persona = {}, random = Math.random) {
  let lastZone = '';
  let streak = 0;
  let lastLine = '';

  return (zone, emotion, mood) => {
    const region = persona.touchReactions?.[zone] || persona.touchReactions?.body || {};
    const allLines = Object.values(region)
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((line) => typeof line === 'string' && line.trim());
    if (!allLines.length) return '{address}，有事直说，别只戳我';

    streak = lastZone === zone ? streak + 1 : 1;
    const moodLines = Array.isArray(region[touchPoolKey(emotion, mood)])
      ? region[touchPoolKey(emotion, mood)] : [];
    const pool = streak >= 3 || !moodLines.length ? allLines : moodLines;
    const candidates = pool.length > 1 ? pool.filter((line) => line !== lastLine) : pool;
    const line = candidates[Math.floor(random() * candidates.length)] || pool[0];
    lastZone = zone;
    lastLine = line;
    return line;
  };
}

module.exports = { touchPoolKey, createTouchPicker };
