const test = require('node:test')
const assert = require('node:assert/strict')

test('build-backend hook exports a default function for electron-builder', () => {
  const hook = require('./build-backend.cjs')

  assert.equal(typeof hook.default, 'function')
})
