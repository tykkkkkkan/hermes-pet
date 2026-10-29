const test = require('node:test');
const assert = require('node:assert/strict');
const createBridgeServer = require('../bridge-server');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeServer() {
  return createBridgeServer({
    getState: () => ({ status: 'idle', tasks: { running: { items: [], total: 0 } } }),
    getVisibility: () => ({ visible: true, chatVisible: false }),
    bridgeFile: () => 'bridge-server-test.json',
    writeJson: () => {},
    appVersion: () => 'test',
    appPath: 'test',
    announce: () => {},
    setStatus: () => {},
    interact: () => {},
    showChat: () => {},
    showPet: () => {},
    hidePet: () => {}
  });
}

test('缺 token 和错 token 都不能通过桥接鉴权', () => {
  const server = makeServer();
  assert.equal(server.bridgeAuthorized({ headers: {} }), false);
  assert.equal(server.bridgeAuthorized({ headers: { authorization: 'Bearer wrong' } }), false);
});

test('bridgeState 保持基线字段结构', () => {
  const server = makeServer();
  const state = server.bridgeState();
  assert.deepEqual(Object.keys(state).sort(), ['chatVisible', 'pid', 'status', 'tasks', 'visible'].sort());
  assert.equal(state.visible, true);
  assert.equal(state.chatVisible, false);
});

test('桥接端口占用时会重试并最终监听', async () => {
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;
  const bridgeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pet-bridge-')), 'bridge.json');
  const logs = [];
  const server = createBridgeServer({
    ...makeServerOptions(),
    bridgeFile: () => bridgeFile,
    writeJson: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
    logger: { error: (...args) => logs.push(args.join(' ')) },
    listenPort: port
  });
  server.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await new Promise((resolve) => blocker.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(fs.existsSync(bridgeFile), true);
  assert.ok(logs.some((line) => line.includes('bridge error')));
  server.stop();
});

function makeServerOptions() {
  return {
    getState: () => ({}),
    getVisibility: () => ({}),
    appVersion: () => 'test',
    appPath: 'test',
    announce: () => {},
    setStatus: () => {},
    interact: () => {},
    showChat: () => {},
    showPet: () => {},
    hidePet: () => {}
  };
}
