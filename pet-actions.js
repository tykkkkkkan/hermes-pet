// 每个动作拥有独立动画名和时长，避免用同一段晃动换力度冒充多个动作。
const RAW_ACTIONS = [
  ['head','hat-check','sweat','hatCheck',900,[],['inspect'],{rot:[[0,0],[.35,-4],[.68,2],[.84,-.6],[1,0]],dy:[[0,0],[.35,-2],[.68,1],[1,0]],eye:[[0,1],[.3,.94],[.7,1.04],[1,1]],lean:[[0,0],[.35,-1],[.68,.5],[1,0]]}],
  ['head','soft-lean','heart','softLean',980,['开心','兴奋'],['seek'],{rot:[[0,0],[.35,5],[.72,-2],[.86,.5],[1,0]],dy:[[0,0],[.35,-4],[.72,1],[1,0]],lean:[[0,0],[.35,-2],[.72,1],[1,0]],eye:[[0,1],[.3,1.03],[.75,.98],[1,1]]}],
  ['head','proud-bow','star','proudBow',1080,['得意'],['celebrate'],{rot:[[0,0],[.38,-5],[.7,2],[.84,-.6],[1,0]],dy:[[0,0],[.38,3],[.7,-2],[1,0]],eye:[[0,1],[.35,.92],[.7,1.05],[1,1]],mouth:[[0,0],[.4,.25],[.72,.1],[1,0]]}],
  ['face','double-blink','star','doubleBlink',620,[],['settle'],{eye:[[0,1],[.25,.12],[.48,1],[.67,.16],[.84,1],[1,1]],mouth:[[0,0],[.4,.05],[1,0]]}],
  ['face','look-away','question','lookAway',760,['委屈','有点烦','闹别扭'],['withdraw','inspect'],{rot:[[0,0],[.42,4],[.78,-1],[.88,.3],[1,0]],eye:[[0,1],[.35,.88],[.78,.92],[1,1]],lean:[[0,0],[.42,1],[.78,-.5],[1,0]]}],
  ['face','startle','exclaim','startle',540,['犯困','平静'],['panic'],{rot:[[0,0],[.22,-3],[.52,2],[.8,-.4],[1,0]],dy:[[0,0],[.22,-7],[.52,2],[1,0]],eye:[[0,1],[.22,1.18],[.52,.96],[1,1]],mouth:[[0,0],[.22,.35],[.6,.08],[1,0]]}],
  ['body','jelly-bounce','note','jellyBounce',840,['开心','兴奋'],['celebrate'],{jump:[[0,0],[.3,-6],[.62,2],[.82,-.8],[1,0]],lean:[[0,0],[.3,-2],[.62,2],[1,0]],breath:[[0,1],[.3,1.12],[.62,.94],[1,1]],eye:[[0,1],[.3,1.05],[.62,.94],[1,1]]}],
  ['body','side-brace','sweat','sideBrace',760,['有点烦','闹别扭'],['withdraw'],{rot:[[0,0],[.35,-4],[.75,1],[.87,-.3],[1,0]],lean:[[0,0],[.35,-3],[.75,2],[1,0]],dy:[[0,0],[.35,-1],[.75,1],[1,0]]}],
  ['body','cape-flick','dust','capeFlick',980,['得意'],['celebrate','withdraw'],{rot:[[0,0],[.32,6],[.65,-3],[.84,.7],[1,0]],lean:[[0,0],[.32,2],[.65,-1],[1,0]],eye:[[0,1],[.3,.95],[.7,1.03],[1,1]]}],
  ['feet','quick-hop','dust','quickHop',720,['兴奋'],['celebrate'],{jump:[[0,0],[.24,-14],[.54,2],[.74,-2],[1,0]],lean:[[0,0],[.24,-2],[.54,3],[1,0]],eye:[[0,1],[.3,1.25],[.62,.85],[1,1]],mouth:[[0,0],[.48,.3],[1,0]],rot:[[0,0],[.24,-3],[.54,2],[1,0]]}],
  ['feet','stumble','exclaim','stumble',680,['委屈','犯困'],['panic'],{rot:[[0,0],[.28,8],[.57,-5],[.78,1],[1,0]],dy:[[0,0],[.28,1],[.57,-2],[1,0]],lean:[[0,0],[.28,2],[.57,-2],[1,0]],eye:[[0,1],[.3,.8],[.65,1.08],[1,1]]}],
  ['feet','heel-tap','note','heelTap',900,['有点烦'],['settle'],{jump:[[0,0],[.38,-4],[.62,1],[.82,-.5],[1,0]],rot:[[0,0],[.38,-3],[.62,3],[.82,-.7],[1,0]],lean:[[0,0],[.38,-1],[.62,1],[1,0]]}],
  ['idle','slow-yawn','ellipsis','slowYawn',1250,['犯困'],['settle'],{rot:[[0,0],[.45,-3],[.75,2],[.87,-.5],[1,0]],dy:[[0,0],[.45,3],[.75,1],[1,0]],eye:[[0,1],[.45,.35],[.75,.65],[1,1]],mouth:[[0,0],[.45,.5],[.75,.15],[1,0]],breath:[[0,1],[.45,.8],[.75,1.05],[1,1]]}],
  ['playful','cheer','star','cheer',980,['开心','兴奋'],['celebrate'],{jump:[[0,0],[.28,-9],[.58,1],[.82,-1],[1,0]],rot:[[0,0],[.28,-5],[.58,4],[.82,-.8],[1,0]],eye:[[0,1],[.3,1.1],[.65,.95],[1,1]],mouth:[[0,0],[.3,.4],[.7,.15],[1,0]]}],
  ['magic','sparkle-cast','heart','sparkleCast',920,['开心','兴奋'],['celebrate','seek'],{rot:[[0,0],[.35,-4],[.7,4],[.84,-.7],[1,0]],dy:[[0,0],[.35,-6],[.7,-1],[1,0]],eye:[[0,1],[.35,1.1],[.7,.96],[1,1]],mouth:[[0,0],[.35,.3],[.7,.1],[1,0]]}]
];
const ACTIONS = RAW_ACTIONS.map(([group,id,effect,animation,duration,moods,intents,tracks], index) => ({ group,id,effect,animation,duration,moods,intents,tracks,index }));

const TOUCH_GROUP = { head: 'head', face: 'face', body: 'body', feet: 'feet' };

function chooseAction(group, previousId = '', mood = '', intent = '', random = Math.random) {
  if (typeof mood === 'function') { random = mood; mood = ''; intent = ''; }
  if (typeof intent === 'function') { random = intent; intent = ''; }
  const pool = group === 'all' ? ACTIONS : ACTIONS.filter((action) => action.group === group);
  if (!pool.length) return null;
  const candidates = pool.length > 1 ? pool.filter((action) => action.id !== previousId) : pool;
  const weighted = candidates.map((action) => {
    let weight = 1;
    if (mood && action.moods.length) weight *= action.moods.includes(mood) ? 3 : 0.2;
    if (intent && action.intents.length) weight *= action.intents.includes(intent) ? 3 : 0.2;
    return { action, weight };
  });
  const total = weighted.reduce((sum, row) => sum + row.weight, 0);
  let pick = random() * total;
  return (weighted.find((row) => (pick -= row.weight) < 0) || weighted.at(-1)).action;
}

module.exports = { ACTIONS, TOUCH_GROUP, chooseAction };
