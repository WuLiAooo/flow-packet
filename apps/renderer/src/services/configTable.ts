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

export interface ConfigTableDocument {
  sourceType: 'xml' | 'xlsx'
  filePath: string
  fileName: string
  sheetName?: string
  sheetNames?: string[]
  columns: string[]
  rows: Record<string, string>[]
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

export function openConfigDocument(filePath: string, sheetName?: string) {
  return sendRequest('configDocument.open', { filePath, sheetName }) as Promise<ConfigTableDocument>
}

export function saveConfigDocument(document: ConfigTableDocument) {
  return sendRequest('configDocument.save', document) as Promise<{
    status: string
  }>
}
