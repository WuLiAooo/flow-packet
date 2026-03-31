export const LONG_SCALAR_TYPES = new Set([
  'int64',
  'uint64',
  'sint64',
  'fixed64',
  'sfixed64',
  'i64',
])

export function isLongScalarType(type: string): boolean {
  return LONG_SCALAR_TYPES.has(type)
}

export function isTextScalarType(type: string): boolean {
  return type === 'string' || type === 'bytes'
}

export function isFloatScalarType(type: string): boolean {
  return type === 'float' || type === 'double'
}

export function isStringBackedScalarType(type: string): boolean {
  return isTextScalarType(type) || isLongScalarType(type)
}

export function getDefaultScalarValue(type: string, kind?: string): unknown {
  if (kind === 'message') {
    return {}
  }
  if (type === 'bool') {
    return false
  }
  if (isStringBackedScalarType(type)) {
    return ''
  }
  return 0
}
