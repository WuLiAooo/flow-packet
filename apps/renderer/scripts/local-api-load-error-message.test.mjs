import test from 'node:test'
import assert from 'node:assert/strict'

import * as localApiErrorMessage from '../src/components/collection/localApiErrorMessage.js'

test('list load errors are masked with a fixed game service message', () => {
  const message = localApiErrorMessage.getLocalApiListLoadErrorMessage(
    'request game api: Get "http://127.0.0.1:8070/api?...": dial tcp 127.0.0.1:8070: connectex: No connection could be made because the target machine actively refused it.'
  )

  assert.equal(message, '游戏服务未启动')
})

test('list load errors use a stable toast id for deduplication', () => {
  assert.equal(localApiErrorMessage.LOCAL_API_LIST_LOAD_ERROR_TOAST_ID, 'local-api-list-load-error')
})
