import test from 'node:test'
import assert from 'node:assert/strict'

import * as localApiErrorMessage from '../src/components/collection/localApiErrorMessage.js'

test('list load errors are masked with a fixed game service message', () => {
  const message = localApiErrorMessage.getLocalApiListLoadErrorMessage(
    'request game api: Get "http://127.0.0.1:8070/api?...": dial tcp 127.0.0.1:8070: connectex: No connection could be made because the target machine actively refused it.'
  )

  assert.equal(message, '\u6e38\u620f\u670d\u52a1\u672a\u542f\u52a8')
})

test('list load errors use a stable toast id for deduplication', () => {
  assert.equal(localApiErrorMessage.LOCAL_API_LIST_LOAD_ERROR_TOAST_ID, 'local-api-list-load-error')
})

test('execute timeout errors are masked with a fixed timeout message', () => {
  const message = localApiErrorMessage.getLocalApiExecuteErrorMessage('Request timeout')

  assert.equal(message, '\u6267\u884capi\u8d85\u65f6')
})

test('execute non-timeout errors preserve the original detail', () => {
  const message = localApiErrorMessage.getLocalApiExecuteErrorMessage('game api request failed (500): boom')

  assert.equal(message, 'game api request failed (500): boom')
})