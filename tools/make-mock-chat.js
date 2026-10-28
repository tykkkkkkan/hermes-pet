/* 生成一份带假数据的 chat 页面，只为截图验收视觉效果。
 * 不参与运行，也不进版本库（.gitignore 里 *.tmp 与 _mock 已排除）。
 */
const fs = require('fs');
const path = require('path');

const now = Date.now();
const data = {
  history: {
    entries: [
      { role: 'user', content: '帮我看下 408 真题的进度', at: now - 3600000 },
      {
        role: 'assistant',
        content: [
          '查过了，进度是这样：',
          '',
          '- 2019 年阅读：**已完成**',
          '- 2020 年阅读：进行中（2/4 篇）',
          '- 2021 年：还没开始',
          '',
          '跑一下统计脚本：',
          '',
          '```python',
          'import pandas as pd',
          'df = pd.read_csv("progress.csv")',
          'print(df.tail())',
          '```',
          '',
          '按现在速度，剩下两篇大概还要 40 分钟。要我起个任务盯着吗？'
        ].join('\n'),
        at: now - 3500000
      },
      { role: 'user', content: '好，起一个', at: now - 600000 },
      { role: 'assistant', content: '已经派下去了，标题叫「2020 阅读剩余两篇」。跑完我叫你。', at: now - 400000 }
    ]
  },
  settings: {
    hasApiKey: true, petScale: 100, petOpacity: 100, voiceEnabled: true,
    voiceRate: 100, voiceVolume: 85, dndStart: '23:30', dndEnd: '08:00',
    dndAllowApproval: true, lineFrequency: 'normal'
  },
  state: { mood: 72, affection: 41, hermesOnline: true, runningCount: 2, hermesText: '在线 · 2 个在跑' }
};

const src = path.join(__dirname, '..', 'renderer', 'chat.html');
const out = path.join(__dirname, '..', 'renderer', '_mock-chat.html');

const mock = `<script>
window.pet = new Proxy({}, { get: (t, k) => (k in t ? t[k] : async () => ({})) });
Object.assign(window.pet, {
  formatUtterance: async (t) => t,
  getSessionHistory: async () => (${JSON.stringify(data.history)}),
  getSettings: async () => (${JSON.stringify(data.settings)}),
  getState: async () => (${JSON.stringify(data.state)}),
  onState: () => {}, onAnnounce: () => {}, onOpenSettings: () => {}
});
</script>
`;

const html = fs.readFileSync(src, 'utf8')
  .replace('<script src="chat.js"></script>', mock + '<script src="chat.js"></script>');

fs.writeFileSync(out, html, 'utf8');
console.log('已生成', out);
