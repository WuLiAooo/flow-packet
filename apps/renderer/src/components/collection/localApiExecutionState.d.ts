import type { LocalGameApiExecuteResult } from '@/services/api'

export declare function createLocalApiExecutionStartState<T extends Record<string, unknown>>(previousState?: T & {
  result?: LocalGameApiExecuteResult | null
  activeResultMatchIndex?: number
}): T & {
  result: null
  activeResultMatchIndex: 0
}
