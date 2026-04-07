import test from 'node:test'
import assert from 'node:assert/strict'

import { getConnectFailureToastOptions } from '../src/components/connection/connectionToastContent.js'

test('entering a connection does not expose low-level connect error details in the toast', () => {
  const options = getConnectFailureToastOptions(
    'connect failed: dial tcp 192.168.120.81:8801: connectex: No connection could be made because the target machine actively refused it.'
  )

  assert.deepEqual(options, {})
})

test('reconnecting does not expose low-level connect error details in the toast', () => {
  const options = getConnectFailureToastOptions(
    'connect failed: dial tcp 192.168.120.81:8801: connectex: No connection could be made because the target machine actively refused it.'
  )

  assert.deepEqual(options, {})
})
