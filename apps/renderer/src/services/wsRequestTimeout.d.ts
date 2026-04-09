export interface NormalizedSendRequestTimeout {
  enabled: boolean
  timeoutMs: number
  timeoutMessage: string
}

export declare function normalizeSendRequestTimeout(options?: {
  timeoutMs?: number
  timeoutMessage?: string
}): NormalizedSendRequestTimeout