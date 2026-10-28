#!/usr/bin/env node
/**
 * 拉取 Live2D 运行所需的二进制资源：
 *   1. Cubism Core 4.x  → renderer/vendor/live2dcubismcore.min.js
 *   2. 官方示例模型 Hiyori → assets/live2d/Hiyori/
 *
 * 这两个都不进仓库：Core 是 Live2D 专有软件，示例模型受 Free Material License 约束。
 * 用法：npm run fetch:live2d [-- --force]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FORCE = process.argv.includes('--force');

const CORE_TARGET = path.join(ROOT, 'renderer', 'vendor', 'live2dcubismcore.min.js');
// Core 4.x：pixi-live2d-display 0.4 不兼容 Core 5+，csmGetVersion 应为 0x0402xxxx
const CORE_SOURCES = [
  'https://cdn.jsdelivr.net/gh/kypanz/waifu-live2d-desktop@main/Core/live2dcubismcore.min.js',
  'https://fastly.jsdelivr.net/gh/kypanz/waifu-live2d-desktop@main/Core/live2dcubismcore.min.js'
];

const MODEL_BASE = 'https://gitee.com/boomer001/CubismWebSamples/raw/develop/Samples/Resources/Hiyori';
const MODEL_DIR = path.join(ROOT, 'assets', 'live2d', 'Hiyori');
const MODEL_FILES = [
  ['Hiyori.moc3', 400000],
  ['Hiyori.model3.json', 1000],
  ['Hiyori.physics3.json', 10000],
  ['Hiyori.pose3.json', 100],
  ['Hiyori.userdata3.json', 100],
  ['Hiyori.cdi3.json', 1000],
  ['Hiyori.2048/texture_00.png', 1000000],
  ['Hiyori.2048/texture_01.png', 1000000]
];
const MOTIONS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

async function download(url, target, minSize) {
  if (!FORCE && sizeOf(target) >= minSize) {
    console.log(`  skip  ${path.relative(ROOT, target)} (${sizeOf(target)}B)`);
    return true;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minSize) {
    throw new Error(`文件不完整：${buf.length}B < ${minSize}B（${url}）`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  console.log(`  ok    ${path.relative(ROOT, target)} (${buf.length}B)`);
  return true;
}

async function fetchCore() {
  console.log('Cubism Core 4.x');
  if (!FORCE && sizeOf(CORE_TARGET) >= 100000) {
    const head = fs.readFileSync(CORE_TARGET, 'utf8').slice(0, 4000);
    if (!head.includes('MocVersion_50')) {
      console.log(`  skip  ${path.relative(ROOT, CORE_TARGET)} (已是 4.x)`);
      return;
    }
    console.log('  检测到 5.x Core，需要替换');
  }
  let lastErr;
  for (const url of CORE_SOURCES) {
    try {
      await download(url, CORE_TARGET, 100000);
      const body = fs.readFileSync(CORE_TARGET, 'utf8');
      if (body.includes('MocVersion_50')) {
        throw new Error('拿到的是 Core 5.x，与 pixi-live2d-display 0.4 不兼容');
      }
      return;
    } catch (err) {
      lastErr = err;
      console.log(`  失败，换下一个源：${err.message}`);
    }
  }
  throw lastErr;
}

async function fetchModel() {
  console.log('示例模型 Hiyori');
  for (const [rel, minSize] of MODEL_FILES) {
    await download(`${MODEL_BASE}/${rel}`, path.join(MODEL_DIR, rel), minSize);
  }
  for (const n of MOTIONS) {
    await download(
      `${MODEL_BASE}/motions/Hiyori_m${n}.motion3.json`,
      path.join(MODEL_DIR, 'motions', `Hiyori_m${n}.motion3.json`),
      1000
    );
  }
}

(async () => {
  try {
    await fetchCore();
    await fetchModel();
    console.log('\n完成。验证页：PET_LIVE2D_TEST=1 npm start');
  } catch (err) {
    console.error('\n拉取失败：', err.message);
    console.error('可手动放置：');
    console.error('  renderer/vendor/live2dcubismcore.min.js  （Cubism SDK for Web 4-r.x 的 Core）');
    console.error('  assets/live2d/Hiyori/                     （官方示例模型）');
    process.exit(1);
  }
})();
