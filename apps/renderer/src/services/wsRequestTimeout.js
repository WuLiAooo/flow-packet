export function normalizeSendRequestTimeout(options) {
  const timeoutMs = options?.timeoutMs ?? 30000
  const timeoutMessage = options?.timeoutMessage ?? 'Request timeout'

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      enabled: false,
      timeoutMs: 0,
      timeoutMessage,
    }
  }

  return {
    enabled: true,
    timeoutMs,
    timeoutMessage,
  }
}