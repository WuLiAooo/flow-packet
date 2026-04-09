import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSendRequestTimeout } from '../src/services/wsRequestTimeout.js'

test('sendRequest uses a 30 second timeout by default', () => {
  const timeout = normalizeSendRequestTimeout()

  assert.deepEqual(timeout, {
    enabled: true,
    timeoutMs: 30000,
    timeoutMessage: 'Request timeout',
  })
})

test('sendRequest can disable timeout explicitly for long-running requests', () => {
  const timeout = normalizeSendRequestTimeout({
    timeoutMs: 0,
  })

  assert.deepEqual(timeout, {
    enabled: false,
    timeoutMs: 0,
    timeoutMessage: 'Request timeout',
  })
})
