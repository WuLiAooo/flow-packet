export type PendingNavigationTarget = {
  type: 'root' | 'group' | 'file' | 'sheet'
  value: string
}

export type ConfigTableRow = {
  rowIndex: number
  values: Record<string, string>
}

export type SnapshotDocument = {
  columns: string[]
  rows: ConfigTableRow[] | Record<string, string>[]
  sheetName?: string
}

export type ConfigTableStatItem = {
  label: string
  value: string
}

export type ConfigFileSearchItem = {
  id: string
  groupKey?: string
  sourceType: 'xml' | 'xlsx'
  fileName: string
  filePath: string
}

export type ConfigTableSearch = {
  column?: string
  value?: string
  exact?: boolean
}

export type ConfigTableDocumentLike = {
  sourceType: 'xml' | 'xlsx'
  filePath: string
  sheetName?: string
  columns: string[]
  rows?: ConfigTableRow[]
  totalRows?: number
}

export type ConfigTableSaveRequest = {
  sourceType: 'xml' | 'xlsx'
  filePath: string
  sheetName?: string
  columns: string[]
  rowPatches: ConfigTableRow[]
}

export const CONFIG_TABLE_TAB_ID: 'config-table'
export const CONFIG_TABLE_ALL_COLUMNS: '__all__'
export const DEFAULT_CONFIG_TABLE_PAGE_SIZE: 200

export function buildVisibleColumns(columns: string[], hiddenColumns: Set<string>): string[]
export function createDocumentSnapshot(document: SnapshotDocument): string
export function hasDocumentChanges(snapshot: string, document: SnapshotDocument): boolean
export function hasEditedRows(editedRows: Map<number, Record<string, string>>): boolean
export function decidePendingNavigation(isDirty: boolean, pendingTarget: PendingNavigationTarget): {
  allow: boolean
  pending: PendingNavigationTarget | null
}
export function buildConfigTableStats(
  document: Pick<ConfigTableDocumentLike, 'columns' | 'rows' | 'totalRows'> | null,
  visibleColumnCount: number,
  isDirty: boolean,
): ConfigTableStatItem[]
export function mergeConfigRows(
  rows: ConfigTableRow[],
  editedRows: Map<number, Record<string, string>>,
): ConfigTableRow[]
export function appendConfigRowsPage(
  currentRows: ConfigTableRow[],
  nextRows: ConfigTableRow[],
): ConfigTableRow[]
export function computeConfigVirtualWindow(args: {
  rowCount: number
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  overscan: number
}): {
  startIndex: number
  endIndex: number
  offsetTop: number
  offsetBottom: number
}
export function buildConfigSaveRequest(
  document: ConfigTableDocumentLike,
  editedRows: Map<number, Record<string, string>>,
): ConfigTableSaveRequest
export function getConfigRowIDValue(
  row: ConfigTableRow | Record<string, string> | null | undefined,
): string
export function normalizeConfigFileSearchText(value: string): string
export function compactConfigFileSearchText(value: string): string
export function filterConfigFiles(
  files: ConfigFileSearchItem[],
  sourceType: 'xml' | 'xlsx',
  query: string,
): ConfigFileSearchItem[]
