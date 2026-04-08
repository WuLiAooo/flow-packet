export type PendingNavigationTarget = {
  type: 'root' | 'group' | 'file' | 'sheet'
  value: string
}

export type SnapshotDocument = {
  columns: string[]
  rows: Record<string, string>[]
  sheetName?: string
}

export type ConfigTableStatItem = {
  label: string
  value: string
}

export type ConfigFileSearchItem = {
  id: string
  groupKey: string
  sourceType: 'xml' | 'xlsx'
  fileName: string
  filePath: string
}

export const CONFIG_TABLE_TAB_ID: 'config-table'

export function buildVisibleColumns(columns: string[], hiddenColumns: Set<string>): string[]
export function createDocumentSnapshot(document: SnapshotDocument): string
export function hasDocumentChanges(snapshot: string, document: SnapshotDocument): boolean
export function decidePendingNavigation(isDirty: boolean, pendingTarget: PendingNavigationTarget): {
  allow: boolean
  pending: PendingNavigationTarget | null
}
export function buildConfigTableStats(
  document: SnapshotDocument | null,
  visibleColumnCount: number,
  isDirty: boolean,
): ConfigTableStatItem[]
export function getConfigRowIDValue(row: Record<string, string> | null | undefined): string
export function normalizeConfigFileSearchText(value: string): string
export function compactConfigFileSearchText(value: string): string
export function filterConfigFiles(
  files: ConfigFileSearchItem[],
  sourceType: 'xml' | 'xlsx',
  query: string,
): ConfigFileSearchItem[]
