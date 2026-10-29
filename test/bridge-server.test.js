const test = require('node:test');
const assert = require('node:assert/strict');
const createBridgeServer = require('../bridge-server');

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
