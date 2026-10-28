const FACE_FILES = Object.freeze({
  idle: 'face-calm',
  happy: 'face-laugh',
  sleepy: 'face-yawn',
  thinking: 'face-serious',
  angry: 'face-angry',
  cry: 'face-cry',
  smug: 'face-smug',
  frown: 'face-frown',
  speechless: 'face-speechless',
  surprised: 'face-surprised',
  shy: 'face-shy',
  shock: 'face-shock'
});

const EMOTION_FACE = Object.freeze({
  '平静': 'idle',
  '开心': 'happy',
  '得意': 'smug',
  '犯困': 'sleepy',
  '有点烦': 'frown',
  '闹别扭': 'speechless',
  '兴奋': 'surprised',
  '委屈': 'shy'
});

const STATE_FACE = Object.freeze({
  success: 'happy',
  sleep: 'sleepy',
  thinking: 'thinking',
  working: 'thinking'
});

function findMissingFaceKeys(faceSources) {
  const keys = new Set(Object.keys(faceSources || {}));
  const used = new Set([
    ...Object.values(EMOTION_FACE),
    ...Object.values(STATE_FACE),
    'idle',
    'cry',
    'angry'
  ]);
  return [...used].filter((key) => !keys.has(key));
}

module.exports = {
  FACE_FILES,
  EMOTION_FACE,
  STATE_FACE,
  findMissingFaceKeys
};
