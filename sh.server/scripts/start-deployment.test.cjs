const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startDeployment } = require('./start-deployment.cjs');

test('API starts only after successful migration', () => {
  const events = [];
  assert.equal(startDeployment({
    migrate: () => { events.push('migration'); return { status: 0 }; },
    start: () => events.push('API'),
  }), 0);
  assert.deepEqual(events, ['migration', 'API']);
});

for (const result of [{ status: 2 }, { status: null, signal: 'SIGTERM' },
  { error: new Error('private connection detail') }]) {
  test(`migration failure blocks API startup (${result.status ?? result.signal ?? 'spawn'})`, () => {
    let started = false;
    const logs = [];
    const code = startDeployment({ migrate: () => result,
      start: () => { started = true; }, log: message => logs.push(message) });
    assert.ok(code > 0);
    assert.equal(started, false);
    assert.ok(logs[0].includes('API was not started'));
    assert.ok(!logs.join('').includes('private connection detail'));
  });
}
