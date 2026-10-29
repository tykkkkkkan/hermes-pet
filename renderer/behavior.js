const BEHAVIOR_CONFIG = {
  sleeping: { minMs: Infinity, maxMs: Infinity, intents: [], attention: 'none', face: 'sleepy' },
  drowsy: { minMs: 9000, maxMs: 16000, intents: ['settle'], attention: 'mouse', face: 'sleepy' },
  idle: { minMs: 3500, maxMs: 8000, intents: [], attention: 'mouse' },
  curious: { minMs: 2200, maxMs: 5000, intents: ['inspect', 'settle'], attention: 'mouse' },
  focused: { minMs: 5000, maxMs: 9000, intents: ['settle'], attention: 'task', face: 'thinking' },
  worried: { minMs: 1800, maxMs: 3200, intents: ['panic', 'withdraw'], attention: 'task' },
  pleased: { minMs: 1500, maxMs: 3000, intents: ['celebrate'], attention: 'mouse', face: 'happy' },
  sulky: { minMs: 4000, maxMs: 7000, intents: ['withdraw'], attention: 'none' },
  clingy: { minMs: 2000, maxMs: 4500, intents: ['seek', 'settle'], attention: 'mouse', face: 'happy' }
};
function evaluateBehavior({ affection, energy, idleMs, mouseNear, queue, irritability }) {
  const blocked = (queue?.blocked || 0) > 0;
  const running = (queue?.running || 0) > 0;
  const review = (queue?.review || 0) > 0;
  if (energy < 0.12 && idleMs > 120000) return 'sleeping';
  if (irritability >= 3) return 'sulky';
  if (blocked) return 'worried';
  if (energy < 0.3) return 'drowsy';
  if (review) return 'pleased';
  if (running) return 'focused';
  if (mouseNear && affection >= 60) return 'clingy';
  if (mouseNear) return 'curious';
  if (idleMs > 600000 && affection >= 70) return 'clingy';
  return 'idle';
}
if (typeof window !== 'undefined') window.petBehavior = { BEHAVIOR_CONFIG, evaluateBehavior };
if (typeof module !== 'undefined') module.exports = { BEHAVIOR_CONFIG, evaluateBehavior };
