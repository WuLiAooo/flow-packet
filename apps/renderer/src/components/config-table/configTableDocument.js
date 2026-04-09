export const CONFIG_TABLE_TAB_ID = 'config-table'
export const CONFIG_TABLE_ALL_COLUMNS = '__all__'
export const DEFAULT_CONFIG_TABLE_PAGE_SIZE = 200

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

export function hasEditedRows(editedRows) {
  return editedRows.size > 0
}

export function decidePendingNavigation(isDirty, pendingTarget) {
  return isDirty
    ? { allow: false, pending: pendingTarget }
    : { allow: true, pending: null }
}

export function buildConfigTableStats(document, visibleColumnCount, isDirty) {
  return [
    { label: '\u5217', value: String(document?.columns?.length ?? 0) },
    { label: '\u884c', value: String(document?.totalRows ?? document?.rows?.length ?? 0) },
    { label: '\u663e\u793a', value: String(visibleColumnCount) },
    { label: '\u72b6\u6001', value: isDirty ? '\u672a\u4fdd\u5b58' : '\u5df2\u540c\u6b65' },
  ]
}

export function mergeConfigRows(rows, editedRows) {
  return rows.map((row) => {
    const patch = editedRows.get(row.rowIndex)
    if (!patch) {
      return row
    }
    return {
      ...row,
      values: {
        ...row.values,
        ...patch,
      },
    }
  })
}

export function appendConfigRowsPage(currentRows, nextRows) {
  const seenRowIndexes = new Set(currentRows.map((row) => row.rowIndex))
  const appendedRows = nextRows.filter((row) => !seenRowIndexes.has(row.rowIndex))
  return [...currentRows, ...appendedRows]
}

export function computeConfigVirtualWindow({
  rowCount,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
}) {
  if (rowCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      offsetTop: 0,
      offsetBottom: 0,
    }
  }

  const visibleStart = Math.floor(scrollTop / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight)
  const startIndex = Math.max(0, visibleStart - overscan)
  const endIndex = Math.min(rowCount - 1, visibleStart + visibleCount + overscan - 1)
  const offsetTop = startIndex * rowHeight
  const offsetBottom = Math.max(0, (rowCount - endIndex - 1) * rowHeight)

  return {
    startIndex,
    endIndex,
    offsetTop,
    offsetBottom,
  }
}

export function buildConfigSaveRequest(document, editedRows) {
  return {
    sourceType: document.sourceType,
    filePath: document.filePath,
    sheetName: document.sheetName,
    columns: [...document.columns],
    rowPatches: [...editedRows.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([rowIndex, values]) => ({
        rowIndex,
        values: { ...values },
      })),
  }
}

export function getConfigRowIDValue(row) {
  return String(row?.values?.id ?? row?.id ?? '')
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
