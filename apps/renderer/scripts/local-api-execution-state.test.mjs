import test from 'node:test'
import assert from 'node:assert/strict'

import { createLocalApiExecutionStartState } from '../src/components/collection/localApiExecutionState.js'

test('starting a local api execution clears the previous result and resets the active match index', () => {
  const nextState = createLocalApiExecutionStartState({
    result: {
      rawText: '{"ok":true}',
      statusCode: 200,
    },
    activeResultMatchIndex: 3,
    resultSearch: 'ok',
  })

  assert.equal(nextState.result, null)
  assert.equal(nextState.activeResultMatchIndex, 0)
  assert.equal(nextState.resultSearch, 'ok')
})
