import { sendRequest } from './ws'

export interface ConfigGroupSummary {
  groupKey: string
  displayName: string
  excelDirPath?: string
  xmlDirPath?: string
}

export interface ConfigFileEntry {
  id: string
  groupKey: string
  sourceType: 'xml' | 'xlsx'
  fileName: string
  filePath: string
}

export interface ConfigTableSearch {
  column?: string
  value?: string
  exact?: boolean
}

export interface ConfigGroupUpdateResult {
  groupKey: string
  sourceType: 'xml' | 'xlsx'
  directory: string
  output?: string
}

export interface ConfigTableRow {
  rowIndex: number
  values: Record<string, string>
}

export interface ConfigTableColumnMeta {
  column: string
  headerLines?: string[]
}

export interface ConfigTableDocument {
  sourceType: 'xml' | 'xlsx'
  filePath: string
  fileName: string
  sheetName?: string
  sheetNames?: string[]
  columns: string[]
  columnMeta?: ConfigTableColumnMeta[]
  headerRowCount?: number
  rows: ConfigTableRow[]
  totalRows: number
  offset: number
  limit: number
  search?: ConfigTableSearch
}

export interface ConfigTableRowsPage {
  rows: ConfigTableRow[]
  totalRows: number
  offset: number
  limit: number
  search?: ConfigTableSearch
}

export interface ConfigTableQuery {
  offset?: number
  limit?: number
  search?: ConfigTableSearch
}

export interface ConfigTableSaveRequest {
  sourceType: 'xml' | 'xlsx'
  filePath: string
  sheetName?: string
  columns: string[]
  rowPatches: ConfigTableRow[]
}

export function scanConfigRoot(rootPath: string) {
  return sendRequest('configRoot.scan', { rootPath }) as Promise<{
    groups: ConfigGroupSummary[]
  }>
}

export function listConfigGroupFiles(rootPath: string, groupKey: string) {
  return sendRequest('configGroup.files', { rootPath, groupKey }) as Promise<{
    files: ConfigFileEntry[]
  }>
}

export function updateConfigGroup(rootPath: string, groupKey: string, sourceType: ConfigFileEntry['sourceType']) {
  return sendRequest('configGroup.update', { rootPath, groupKey, sourceType }) as Promise<ConfigGroupUpdateResult>
}

export function openConfigDocument(filePath: string, sheetName?: string, query?: ConfigTableQuery) {
  return sendRequest('configDocument.open', {
    filePath,
    sheetName,
    offset: query?.offset,
    limit: query?.limit,
    search: query?.search,
  }) as Promise<ConfigTableDocument>
}

export function listConfigDocumentRows(filePath: string, sheetName?: string, query?: ConfigTableQuery) {
  return sendRequest('configDocument.rows', {
    filePath,
    sheetName,
    offset: query?.offset,
    limit: query?.limit,
    search: query?.search,
  }) as Promise<ConfigTableRowsPage>
}

export function saveConfigDocument(request: ConfigTableSaveRequest) {
  return sendRequest('configDocument.save', request) as Promise<{
    status: string
  }>
}
