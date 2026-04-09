export const LOCAL_API_LIST_LOAD_ERROR_TOAST_ID = 'local-api-list-load-error'
export const LOCAL_API_EXECUTE_TIMEOUT_MESSAGE = '\u6267\u884capi\u8d85\u65f6'

export function getLocalApiListLoadErrorMessage() {
  return '\u6e38\u620f\u670d\u52a1\u672a\u542f\u52a8'
}

export function getLocalApiExecuteErrorMessage(message) {
  const normalized = String(message ?? '').trim()
  if (!normalized) {
    return normalized
  }

  if (
    normalized === 'Request timeout'
    || normalized === LOCAL_API_EXECUTE_TIMEOUT_MESSAGE
    || /timeout/i.test(normalized)
    || /Client\.Timeout exceeded/i.test(normalized)
  ) {
    return LOCAL_API_EXECUTE_TIMEOUT_MESSAGE
  }

  return normalized
}