// 每个动作拥有独立动画名和时长，避免用同一段晃动换力度冒充多个动作。
const ACTIONS = [
  ['head', 'hat-check', 'sweat', 'hatCheck', 900],
  ['head', 'soft-lean', 'heart', 'softLean', 980],
  ['head', 'proud-bow', 'star', 'proudBow', 1080],
  ['face', 'double-blink', 'star', 'doubleBlink', 620],
  ['face', 'look-away', 'question', 'lookAway', 760],
  ['face', 'startle', 'exclaim', 'startle', 540],
  ['body', 'jelly-bounce', 'note', 'jellyBounce', 840],
  ['body', 'side-brace', 'sweat', 'sideBrace', 760],
  ['body', 'cape-flick', 'dust', 'capeFlick', 980],
  ['feet', 'quick-hop', 'dust', 'quickHop', 720],
  ['feet', 'stumble', 'exclaim', 'stumble', 680],
  ['feet', 'heel-tap', 'note', 'heelTap', 900],
  ['idle', 'slow-yawn', 'ellipsis', 'slowYawn', 1250],
  ['playful', 'cheer', 'star', 'cheer', 980],
  ['magic', 'sparkle-cast', 'heart', 'sparkleCast', 920]
].map(([group, id, effect, animation, duration], index) => ({
  group, id, effect, animation, duration, index
}));

const TOUCH_GROUP = { head: 'head', face: 'face', body: 'body', feet: 'feet' };

function chooseAction(group, previousId = '', random = Math.random) {
  const pool = group === 'all' ? ACTIONS : ACTIONS.filter((action) => action.group === group);
  if (!pool.length) return null;
  const candidates = pool.length > 1 ? pool.filter((action) => action.id !== previousId) : pool;
  return candidates[Math.floor(random() * candidates.length)] || pool[0];
}

module.exports = { ACTIONS, TOUCH_GROUP, chooseAction };
