export function createLocalApiExecutionStartState(previousState = {}) {
  return {
    ...previousState,
    result: null,
    activeResultMatchIndex: 0,
  }
}
