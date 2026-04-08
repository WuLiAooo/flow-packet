export const CONFIG_TABLE_TAB_ID = 'config-table'

export function buildVisibleColumns(columns, hiddenColumns) {
  return columns.filter((column) => !hiddenColumns.has(column))
}

export function createDocumentSnapshot(document) {
  return JSON.stringify({
    columns: document.columns,
    rows: document.rows,
    sheetName: document.sheetName ?? '',
  })
}

export function hasDocumentChanges(snapshot, document) {
  return snapshot !== createDocumentSnapshot(document)
}

export function decidePendingNavigation(isDirty, pendingTarget) {
  return isDirty
    ? { allow: false, pending: pendingTarget }
    : { allow: true, pending: null }
}

export function buildConfigTableStats(document, visibleColumnCount, isDirty) {
  return [
    { label: '列', value: String(document?.columns?.length ?? 0) },
    { label: '行', value: String(document?.rows?.length ?? 0) },
    { label: '显示', value: String(visibleColumnCount) },
    { label: '状态', value: isDirty ? '未保存' : '已同步' },
  ]
}

export function getConfigRowIDValue(row) {
  return String(row?.id ?? '')
}

export function normalizeConfigFileSearchText(value) {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

export function compactConfigFileSearchText(value) {
  return normalizeConfigFileSearchText(value).replace(/[\s_./:-]+/g, '')
}

export function filterConfigFiles(files, sourceType, query) {
  const typeFiltered = files.filter((file) => file.sourceType === sourceType)
  const normalizedQuery = normalizeConfigFileSearchText(query)
  if (!normalizedQuery) {
    return typeFiltered
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const compactTokens = tokens.map((token) => compactConfigFileSearchText(token))

  return typeFiltered.filter((file) => {
    const normalizedName = normalizeConfigFileSearchText(file.fileName)
    const compactName = compactConfigFileSearchText(file.fileName)
    return tokens.every((token, index) => (
      normalizedName.includes(token)
      || (compactTokens[index] && compactName.includes(compactTokens[index]))
    ))
  })
}
