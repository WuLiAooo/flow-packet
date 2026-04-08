# Config Table Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local config-table viewer/editor for `C:\top-hero\Meta` with XML/XLSX support, current-sheet save, column visibility, unsaved-change confirmation, and two UI entry points.

**Architecture:** The Go backend owns filesystem scanning plus XML/XLSX parsing and saving, exposed through new websocket actions under the existing handler registry. The React renderer consumes a unified table-document payload, keeps column visibility and dirty state locally, and renders one shared `ConfigTablePage` from both the welcome-page quick entry and the in-connection sidebar tab.

**Tech Stack:** Go backend, Electron, React 19, TypeScript, existing websocket request layer, existing Shadcn/Radix UI primitives, `excelize` for XLSX read/write.

---

## File Map

### Backend
- Create: `apps/server/internal/api/config_table.go`
- Create: `apps/server/internal/api/config_table_test.go`
- Modify: `apps/server/internal/api/handler.go`
- Modify: `apps/server/go.mod`
- Modify: `apps/server/go.sum`

### Renderer
- Create: `apps/renderer/src/services/configTable.ts`
- Create: `apps/renderer/src/components/config-table/ConfigTablePage.tsx`
- Create: `apps/renderer/src/components/config-table/UnsavedConfigDialog.tsx`
- Create: `apps/renderer/src/components/config-table/configTableDocument.js`
- Create: `apps/renderer/src/components/config-table/configTableDocument.d.ts`
- Create: `apps/renderer/scripts/config-table-document.test.mjs`
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/src/components/layout/AppSidebar.tsx`
- Modify: `apps/renderer/src/components/connection/WelcomePage.tsx`

### Responsibilities
- `config_table.go`: typed payloads, group scanning, file listing, XML open/save, XLSX open/save, websocket handlers.
- `config_table_test.go`: temp-dir coverage for scan/list/open/save behaviors and sheet-scoped save.
- `configTable.ts`: renderer request wrappers and shared client-side types.
- `configTableDocument.js`: pure document helpers for visible columns, dirty snapshots, and pending navigation decisions.
- `ConfigTablePage.tsx`: root folder input, group dropdown, file search/list, optional sheet selector, column checkboxes, editable table, save flow.
- `UnsavedConfigDialog.tsx`: shared 3-action confirm dialog.
- `App.tsx`: new in-connection config tab routing.
- `AppSidebar.tsx`: sidebar tab definition and icon.
- `WelcomePage.tsx`: second entry point below quick-add.

### Library Choice
- Add `github.com/xuri/excelize/v2` for XLSX read/write. It supports multi-sheet workbooks and in-place sheet updates without inventing a custom parser.

---

### Task 1: Backend Group Scanning and File Listing

**Files:**
- Create: `apps/server/internal/api/config_table.go`
- Create: `apps/server/internal/api/config_table_test.go`
- Modify: `apps/server/internal/api/handler.go`

- [ ] **Step 1: Write the failing tests for group discovery and file listing**

```go
func TestScanConfigRootReturnsGroupedFolders(t *testing.T) {
	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "meta_role"))
	mustMkdir(t, filepath.Join(root, "meta_role_xml"))
	mustMkdir(t, filepath.Join(root, "meta_item"))

	groups, err := scanConfigRoot(root)
	if err != nil {
		t.Fatalf("scanConfigRoot returned error: %v", err)
	}

	if len(groups) != 2 {
		t.Fatalf("expected 2 groups, got %d", len(groups))
	}
	if groups[0].GroupKey != "meta_item" {
		t.Fatalf("expected sorted group key meta_item, got %s", groups[0].GroupKey)
	}
	if groups[1].XMLDirPath == "" {
		t.Fatalf("expected xml dir path for meta_role")
	}
}

func TestListConfigGroupFilesReturnsXMLAndXLSXEntries(t *testing.T) {
	root := t.TempDir()
	excelDir := filepath.Join(root, "meta_role")
	xmlDir := filepath.Join(root, "meta_role_xml")
	mustMkdir(t, excelDir)
	mustMkdir(t, xmlDir)
	mustWriteFile(t, filepath.Join(excelDir, "active_rules.xlsx"), []byte("xlsx"))
	mustWriteFile(t, filepath.Join(xmlDir, "active_rules.xml"), []byte("<root/>"))

	files, err := listConfigGroupFiles(root, "meta_role")
	if err != nil {
		t.Fatalf("listConfigGroupFiles returned error: %v", err)
	}

	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0].SourceType != "xlsx" || files[1].SourceType != "xml" {
		t.Fatalf("unexpected source types: %#v", files)
	}
}
```

- [ ] **Step 2: Run the Go tests to verify they fail**

Run: `go test ./internal/api -run "TestScanConfigRootReturnsGroupedFolders|TestListConfigGroupFilesReturnsXMLAndXLSXEntries" -v`
Expected: FAIL with undefined `scanConfigRoot` / `listConfigGroupFiles`

- [ ] **Step 3: Implement group scanning, file listing, and handler registration**

```go
type ConfigGroupSummary struct {
	GroupKey    string `json:"groupKey"`
	DisplayName string `json:"displayName"`
	ExcelDirPath string `json:"excelDirPath,omitempty"`
	XMLDirPath   string `json:"xmlDirPath,omitempty"`
}

type ConfigFileEntry struct {
	ID         string `json:"id"`
	GroupKey   string `json:"groupKey"`
	SourceType string `json:"sourceType"`
	FileName   string `json:"fileName"`
	FilePath   string `json:"filePath"`
}

func scanConfigRoot(root string) ([]ConfigGroupSummary, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	groups := map[string]*ConfigGroupSummary{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		groupKey := strings.TrimSuffix(name, "_xml")
		group := groups[groupKey]
		if group == nil {
			group = &ConfigGroupSummary{GroupKey: groupKey, DisplayName: groupKey}
			groups[groupKey] = group
		}
		fullPath := filepath.Join(root, name)
		if strings.HasSuffix(name, "_xml") {
			group.XMLDirPath = fullPath
		} else {
			group.ExcelDirPath = fullPath
		}
	}
	result := make([]ConfigGroupSummary, 0, len(groups))
	for _, group := range groups {
		result = append(result, *group)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].GroupKey < result[j].GroupKey })
	return result, nil
}

func listConfigGroupFiles(root string, groupKey string) ([]ConfigFileEntry, error) {
	// collect .xlsx from root/groupKey and .xml from root/groupKey_xml
}
```

Also register new actions in `apps/server/internal/api/handler.go`:

```go
srv.Handle("configRoot.scan", makeConfigRootScanHandler())
srv.Handle("configGroup.files", makeConfigGroupFilesHandler())
```

- [ ] **Step 4: Run the Go tests to verify they pass**

Run: `go test ./internal/api -run "TestScanConfigRootReturnsGroupedFolders|TestListConfigGroupFilesReturnsXMLAndXLSXEntries" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/internal/api/config_table.go apps/server/internal/api/config_table_test.go apps/server/internal/api/handler.go
git commit -m "feat: add config root scanning and file listing"
```

### Task 2: XML Open and Save Support

**Files:**
- Modify: `apps/server/internal/api/config_table.go`
- Modify: `apps/server/internal/api/config_table_test.go`

- [ ] **Step 1: Write the failing XML open/save tests**

```go
func TestOpenXMLDocumentBuildsColumnsAndRows(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "active_rules.xml")
	mustWriteFile(t, filePath, []byte(`<?xml version="1.0" encoding="UTF-8"?>
<active_rules>
  <active_rule id="1" groupid="1" severtime="0|72" />
  <active_rule id="2" groupid="2" severtime="72|144" />
</active_rules>`))

	doc, err := openConfigDocument(root, filePath, "")
	if err != nil {
		t.Fatalf("openConfigDocument returned error: %v", err)
	}
	if doc.SourceType != "xml" || len(doc.Columns) != 3 || len(doc.Rows) != 2 {
		t.Fatalf("unexpected document: %#v", doc)
	}
}

func TestSaveXMLDocumentWritesEditedAttributeValues(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "active_rules.xml")
	mustWriteFile(t, filePath, []byte(`<?xml version="1.0" encoding="UTF-8"?><active_rules><active_rule id="1" groupid="1"/></active_rules>`))

	doc := &ConfigTableDocument{
		SourceType: "xml",
		FilePath:   filePath,
		Columns:    []string{"id", "groupid"},
		Rows:       []map[string]string{{"id": "1", "groupid": "99"}},
	}
	if err := saveConfigDocument(root, doc); err != nil {
		t.Fatalf("saveConfigDocument returned error: %v", err)
	}
	content, _ := os.ReadFile(filePath)
	if !strings.Contains(string(content), `groupid="99"`) {
		t.Fatalf("expected edited attribute in saved xml: %s", content)
	}
}
```

- [ ] **Step 2: Run the XML tests to verify they fail**

Run: `go test ./internal/api -run "TestOpenXMLDocumentBuildsColumnsAndRows|TestSaveXMLDocumentWritesEditedAttributeValues" -v`
Expected: FAIL with undefined `openConfigDocument` / `saveConfigDocument`

- [ ] **Step 3: Implement XML document open/save functions**

```go
type ConfigTableDocument struct {
	SourceType string              `json:"sourceType"`
	FilePath   string              `json:"filePath"`
	FileName   string              `json:"fileName"`
	SheetName  string              `json:"sheetName,omitempty"`
	SheetNames []string            `json:"sheetNames,omitempty"`
	Columns    []string            `json:"columns"`
	Rows       []map[string]string `json:"rows"`
}

func openConfigDocument(root string, filePath string, sheetName string) (*ConfigTableDocument, error) {
	sourceType := strings.TrimPrefix(strings.ToLower(filepath.Ext(filePath)), ".")
	switch sourceType {
	case "xml":
		return openXMLConfigDocument(filePath)
	case "xlsx":
		return openXLSXConfigDocument(filePath, sheetName)
	default:
		return nil, fmt.Errorf("unsupported config document type: %s", sourceType)
	}
}

func openXMLConfigDocument(filePath string) (*ConfigTableDocument, error) {
	// decode root element, iterate direct children, read attribute keys as columns
}

func saveConfigDocument(root string, doc *ConfigTableDocument) error {
	switch doc.SourceType {
	case "xml":
		return saveXMLConfigDocument(doc)
	case "xlsx":
		return saveXLSXConfigDocument(doc)
	default:
		return fmt.Errorf("unsupported config document type: %s", doc.SourceType)
	}
}
```

Add handler skeletons in the same file for later use:

```go
func makeConfigDocumentOpenHandler() HandlerFunc { /* json payload {filePath,sheetName} */ }
func makeConfigDocumentSaveHandler() HandlerFunc { /* json payload is ConfigTableDocument */ }
```

- [ ] **Step 4: Run the XML tests to verify they pass**

Run: `go test ./internal/api -run "TestOpenXMLDocumentBuildsColumnsAndRows|TestSaveXMLDocumentWritesEditedAttributeValues" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/internal/api/config_table.go apps/server/internal/api/config_table_test.go
git commit -m "feat: add xml config document open and save"
```

### Task 3: XLSX Open and Save Support for Current Sheet Only

**Files:**
- Modify: `apps/server/go.mod`
- Modify: `apps/server/go.sum`
- Modify: `apps/server/internal/api/config_table.go`
- Modify: `apps/server/internal/api/config_table_test.go`

- [ ] **Step 1: Write the failing XLSX tests**

```go
func TestOpenXLSXDocumentUsesFirstSheetByDefault(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "active_rules.xlsx")
	wb := excelize.NewFile()
	wb.SetSheetName("Sheet1", "Rules")
	wb.NewSheet("Meta")
	wb.SetSheetRow("Rules", "A1", &[]string{"id", "groupid"})
	wb.SetSheetRow("Rules", "A2", &[]string{"1", "10"})
	if err := wb.SaveAs(filePath); err != nil {
		t.Fatalf("SaveAs returned error: %v", err)
	}

	doc, err := openConfigDocument(root, filePath, "")
	if err != nil {
		t.Fatalf("openConfigDocument returned error: %v", err)
	}
	if doc.SheetName != "Rules" || len(doc.SheetNames) != 2 {
		t.Fatalf("unexpected workbook metadata: %#v", doc)
	}
}

func TestSaveXLSXDocumentUpdatesCurrentSheetOnly(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "active_rules.xlsx")
	wb := excelize.NewFile()
	wb.SetSheetName("Sheet1", "Rules")
	wb.NewSheet("Meta")
	wb.SetSheetRow("Rules", "A1", &[]string{"id", "groupid"})
	wb.SetSheetRow("Rules", "A2", &[]string{"1", "10"})
	wb.SetSheetRow("Meta", "A1", &[]string{"name"})
	wb.SetSheetRow("Meta", "A2", &[]string{"keep"})
	_ = wb.SaveAs(filePath)

	doc := &ConfigTableDocument{
		SourceType: "xlsx",
		FilePath:   filePath,
		SheetName:  "Rules",
		Columns:    []string{"id", "groupid"},
		Rows:       []map[string]string{{"id": "1", "groupid": "99"}},
	}
	if err := saveConfigDocument(root, doc); err != nil {
		t.Fatalf("saveConfigDocument returned error: %v", err)
	}

	reopened, _ := excelize.OpenFile(filePath)
	value, _ := reopened.GetCellValue("Rules", "B2")
	untouched, _ := reopened.GetCellValue("Meta", "A2")
	if value != "99" || untouched != "keep" {
		t.Fatalf("unexpected workbook values: rules=%s meta=%s", value, untouched)
	}
}
```

- [ ] **Step 2: Run the XLSX tests to verify they fail**

Run: `go test ./internal/api -run "TestOpenXLSXDocumentUsesFirstSheetByDefault|TestSaveXLSXDocumentUpdatesCurrentSheetOnly" -v`
Expected: FAIL until `excelize` is added and XLSX helpers are implemented

- [ ] **Step 3: Add `excelize` and implement current-sheet read/write**

```go
require github.com/xuri/excelize/v2 v2.9.0
```

```go
func openXLSXConfigDocument(filePath string, sheetName string) (*ConfigTableDocument, error) {
	wb, err := excelize.OpenFile(filePath)
	if err != nil {
		return nil, err
	}
	sheetNames := wb.GetSheetList()
	if sheetName == "" {
		sheetName = sheetNames[0]
	}
	rows, err := wb.GetRows(sheetName)
	if err != nil {
		return nil, err
	}
	columns := append([]string(nil), rows[0]...)
	records := make([]map[string]string, 0, max(len(rows)-1, 0))
	for _, row := range rows[1:] {
		record := map[string]string{}
		for index, column := range columns {
			if index < len(row) {
				record[column] = row[index]
			} else {
				record[column] = ""
			}
		}
		records = append(records, record)
	}
	return &ConfigTableDocument{SourceType: "xlsx", FilePath: filePath, FileName: filepath.Base(filePath), SheetName: sheetName, SheetNames: sheetNames, Columns: columns, Rows: records}, nil
}
```

```go
func saveXLSXConfigDocument(doc *ConfigTableDocument) error {
	wb, err := excelize.OpenFile(doc.FilePath)
	if err != nil {
		return err
	}
	for rowIndex, row := range doc.Rows {
		for colIndex, column := range doc.Columns {
			cell, _ := excelize.CoordinatesToCellName(colIndex+1, rowIndex+2)
			if err := wb.SetCellStr(doc.SheetName, cell, row[column]); err != nil {
				return err
			}
		}
	}
	return wb.Save()
}
```

Also finish handler registration in `handler.go`:

```go
srv.Handle("configDocument.open", makeConfigDocumentOpenHandler())
srv.Handle("configDocument.save", makeConfigDocumentSaveHandler())
```

- [ ] **Step 4: Run the XLSX tests to verify they pass**

Run: `go test ./internal/api -run "TestOpenXLSXDocumentUsesFirstSheetByDefault|TestSaveXLSXDocumentUpdatesCurrentSheetOnly" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/go.mod apps/server/go.sum apps/server/internal/api/config_table.go apps/server/internal/api/config_table_test.go apps/server/internal/api/handler.go
git commit -m "feat: add xlsx config document support"
```

### Task 4: Renderer Types, Requests, and Document Helpers

**Files:**
- Create: `apps/renderer/src/services/configTable.ts`
- Create: `apps/renderer/src/components/config-table/configTableDocument.js`
- Create: `apps/renderer/src/components/config-table/configTableDocument.d.ts`
- Create: `apps/renderer/scripts/config-table-document.test.mjs`

- [ ] **Step 1: Write the failing renderer helper tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVisibleColumns,
  createDocumentSnapshot,
  hasDocumentChanges,
} from '../src/components/config-table/configTableDocument.js'

test('buildVisibleColumns removes hidden columns only from presentation', () => {
  assert.deepEqual(
    buildVisibleColumns(['id', 'name', 'level'], new Set(['name'])),
    ['id', 'level']
  )
})

test('hasDocumentChanges detects cell edits for current sheet', () => {
  const baseline = createDocumentSnapshot({ columns: ['id'], rows: [{ id: '1' }] })
  assert.equal(hasDocumentChanges(baseline, { columns: ['id'], rows: [{ id: '2' }] }), true)
  assert.equal(hasDocumentChanges(baseline, { columns: ['id'], rows: [{ id: '1' }] }), false)
})
```

- [ ] **Step 2: Run the renderer helper tests to verify they fail**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: FAIL with module not found / missing exports

- [ ] **Step 3: Implement websocket wrappers and pure document helpers**

`apps/renderer/src/services/configTable.ts`

```ts
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
  return sendRequest('configRoot.scan', { rootPath }) as Promise<{ groups: ConfigGroupSummary[] }>
}

export function listConfigGroupFiles(rootPath: string, groupKey: string) {
  return sendRequest('configGroup.files', { rootPath, groupKey }) as Promise<{ files: ConfigFileEntry[] }>
}

export function openConfigDocument(filePath: string, sheetName?: string) {
  return sendRequest('configDocument.open', { filePath, sheetName }) as Promise<ConfigTableDocument>
}

export function saveConfigDocument(document: ConfigTableDocument) {
  return sendRequest('configDocument.save', document) as Promise<{ status: string }>
}
```

`apps/renderer/src/components/config-table/configTableDocument.js`

```js
export function buildVisibleColumns(columns, hiddenColumns) {
  return columns.filter((column) => !hiddenColumns.has(column))
}

export function createDocumentSnapshot(document) {
  return JSON.stringify({ columns: document.columns, rows: document.rows, sheetName: document.sheetName ?? '' })
}

export function hasDocumentChanges(snapshot, document) {
  return snapshot !== createDocumentSnapshot(document)
}
```

- [ ] **Step 4: Run the renderer helper tests to verify they pass**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/services/configTable.ts apps/renderer/src/components/config-table/configTableDocument.js apps/renderer/src/components/config-table/configTableDocument.d.ts apps/renderer/scripts/config-table-document.test.mjs
git commit -m "feat: add config table client types and helpers"
```

### Task 5: Build the Shared Config Table Page

**Files:**
- Create: `apps/renderer/src/components/config-table/ConfigTablePage.tsx`
- Create: `apps/renderer/src/components/config-table/UnsavedConfigDialog.tsx`
- Modify: `apps/renderer/src/components/ui/alert-dialog.tsx` (only if the existing API blocks the needed 3-action footer; otherwise reuse as-is)
- Test: `apps/renderer/scripts/config-table-document.test.mjs`

- [ ] **Step 1: Extend the helper test to cover pending-navigation behavior**

```js
import { decidePendingNavigation } from '../src/components/config-table/configTableDocument.js'

test('decidePendingNavigation requests confirmation only when current document is dirty', () => {
  assert.deepEqual(decidePendingNavigation(false, { type: 'file', value: 'a.xml' }), { allow: true, pending: null })
  assert.deepEqual(decidePendingNavigation(true, { type: 'file', value: 'a.xml' }), { allow: false, pending: { type: 'file', value: 'a.xml' } })
})
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: FAIL with missing `decidePendingNavigation`

- [ ] **Step 3: Implement the page and unsaved dialog**

Add the helper export:

```js
export function decidePendingNavigation(isDirty, pendingTarget) {
  return isDirty
    ? { allow: false, pending: pendingTarget }
    : { allow: true, pending: null }
}
```

Create `apps/renderer/src/components/config-table/UnsavedConfigDialog.tsx`

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function UnsavedConfigDialog({
  open,
  onSaveAndSwitch,
  onDiscardAndSwitch,
  onCancel,
}: {
  open: boolean
  onSaveAndSwitch: () => void
  onDiscardAndSwitch: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>有未保存修改</AlertDialogTitle>
          <AlertDialogDescription>切换前请先选择保存、放弃，或取消当前操作。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscardAndSwitch}>不保存并切换</AlertDialogAction>
          <AlertDialogAction onClick={onSaveAndSwitch}>保存并切换</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

Create `apps/renderer/src/components/config-table/ConfigTablePage.tsx` with these structural sections:

```tsx
const DEFAULT_ROOT = 'C:\\top-hero\\Meta'

export function ConfigTablePage() {
  const [rootPath, setRootPath] = useState(DEFAULT_ROOT)
  const [groups, setGroups] = useState<ConfigGroupSummary[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [files, setFiles] = useState<ConfigFileEntry[]>([])
  const [fileSearch, setFileSearch] = useState('')
  const [document, setDocument] = useState<ConfigTableDocument | null>(null)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [snapshot, setSnapshot] = useState('')
  const [pendingTarget, setPendingTarget] = useState<PendingTarget | null>(null)

  const visibleColumns = useMemo(
    () => buildVisibleColumns(document?.columns ?? [], hiddenColumns),
    [document?.columns, hiddenColumns],
  )

  const isDirty = document ? hasDocumentChanges(snapshot, document) : false

  // root scan, group file load, file open, sheet switch, cell editing, save, pending-navigation confirm
}
```

Render requirements in the component:
- left sidebar with root folder input, group dropdown, file search, file list
- main header with file name, save button, optional sheet dropdown
- checkbox list for all columns, default checked
- scrollable editable table using existing table primitives
- concise toasts: `打开文件失败`, `保存失败`, `加载文件列表失败`, `加载配置组失败`

- [ ] **Step 4: Run the helper test and renderer build**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/components/config-table/ConfigTablePage.tsx apps/renderer/src/components/config-table/UnsavedConfigDialog.tsx apps/renderer/src/components/config-table/configTableDocument.js apps/renderer/scripts/config-table-document.test.mjs
git commit -m "feat: add shared config table page"
```

### Task 6: Wire the Two Entry Points and In-Connection Tab

**Files:**
- Modify: `apps/renderer/src/components/connection/WelcomePage.tsx`
- Modify: `apps/renderer/src/components/layout/AppSidebar.tsx`
- Modify: `apps/renderer/src/App.tsx`
- Modify: `apps/renderer/src/services/configTable.ts` (only if a shared default-root helper is useful)
- Test: `apps/renderer/scripts/config-table-document.test.mjs`

- [ ] **Step 1: Add a failing helper test for the config tab identity**

```js
import { CONFIG_TABLE_TAB_ID } from '../src/components/config-table/configTableDocument.js'

test('config table tab id is stable for both entry points', () => {
  assert.equal(CONFIG_TABLE_TAB_ID, 'config-table')
})
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: FAIL with missing `CONFIG_TABLE_TAB_ID`

- [ ] **Step 3: Implement both entry points and tab routing**

Add the shared constant:

```js
export const CONFIG_TABLE_TAB_ID = 'config-table'
```

Modify `apps/renderer/src/components/layout/AppSidebar.tsx`:

```tsx
import { CodeXml, Library, LayoutDashboard, TableProperties } from 'lucide-react'

export type SidebarTab = 'canvas' | 'collection' | 'api' | 'config'

const navItems: NavItem[] = [
  { icon: LayoutDashboard, value: 'canvas', label: '画布' },
  { icon: Library, value: 'collection', label: '集合' },
  { icon: CodeXml, value: 'api', label: 'API' },
  { icon: TableProperties, value: 'config', label: '配置表' },
]
```

Modify `apps/renderer/src/App.tsx`:

```tsx
import { ConfigTablePage } from '@/components/config-table/ConfigTablePage'

const showConfigTab = Boolean(activeConnectionId)

useEffect(() => {
  if (!showConfigTab && activeTab === SIDEBAR_TABS.config) {
    setActiveTab(SIDEBAR_TABS.canvas)
  }
}, [activeTab, showConfigTab])

const isConfigTab = showConfigTab && activeTab === SIDEBAR_TABS.config
```

In the main layout branch:

```tsx
center={
  isApiTab ? (
    <LocalApiBrowser />
  ) : isConfigTab ? (
    <ConfigTablePage />
  ) : activeTabId ? (
    <FlowCanvas />
  ) : (
    <EmptyCanvas />
  )
}
```

Pass tab visibility into `AppSidebar` by extending the prop shape:

```tsx
<AppSidebar activeTab={activeTab} onTabChange={setActiveTab} showApiTab={showApiTab} showConfigTab={showConfigTab} />
```

Modify `apps/renderer/src/components/connection/WelcomePage.tsx` by adding a second button under the existing quick-add button:

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    className="min-w-8 border border-border bg-background text-foreground duration-200 ease-linear hover:bg-accent hover:text-accent-foreground"
    onClick={() => onEnterConfigTable?.()}
  >
    <TableProperties className="size-4" />
    <span>配置表</span>
  </SidebarMenuButton>
</SidebarMenuItem>
```

Update `WelcomePageProps` and `App.tsx` so the welcome-page entry opens the same `ConfigTablePage` experience without requiring a live game API tab state.

- [ ] **Step 4: Run the helper test and full renderer build**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/components/connection/WelcomePage.tsx apps/renderer/src/components/layout/AppSidebar.tsx apps/renderer/src/App.tsx apps/renderer/src/components/config-table/configTableDocument.js apps/renderer/scripts/config-table-document.test.mjs
git commit -m "feat: add config table entry points"
```

### Task 7: End-to-End Verification and Cleanup

**Files:**
- Modify: any touched files from previous tasks only if verification exposes real defects
- Test: `apps/server/internal/api/config_table_test.go`
- Test: `apps/renderer/scripts/config-table-document.test.mjs`

- [ ] **Step 1: Run the backend test suite for the new feature**

Run: `go test ./internal/api -run "TestScanConfigRootReturnsGroupedFolders|TestListConfigGroupFilesReturnsXMLAndXLSXEntries|TestOpenXMLDocumentBuildsColumnsAndRows|TestSaveXMLDocumentWritesEditedAttributeValues|TestOpenXLSXDocumentUsesFirstSheetByDefault|TestSaveXLSXDocumentUpdatesCurrentSheetOnly" -v`
Expected: all listed tests PASS

- [ ] **Step 2: Run the renderer helper tests**

Run: `node --test scripts/config-table-document.test.mjs`
Expected: PASS

- [ ] **Step 3: Run the renderer production build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Manual smoke test in Electron dev flow**

Run: `npm run dev:electron`
Expected:
- welcome page shows a `配置表` entry below `快速添加`
- entering a connection shows a `配置表` tab below `API`
- root folder scan loads groups from `C:\top-hero\Meta`
- opening XML renders editable rows
- opening XLSX renders the first sheet and allows switching sheets
- hidden columns disappear from the table only
- save updates the current XML or current XLSX sheet only
- switching root/group/file/sheet while dirty shows the 3-action dialog

- [ ] **Step 5: Commit final verification fixes**

```bash
git add apps/server/internal/api/config_table.go apps/server/internal/api/config_table_test.go apps/renderer/src/services/configTable.ts apps/renderer/src/components/config-table apps/renderer/src/App.tsx apps/renderer/src/components/layout/AppSidebar.tsx apps/renderer/src/components/connection/WelcomePage.tsx apps/renderer/scripts/config-table-document.test.mjs
git commit -m "feat: ship config table editor"
```

## Self-Review

### Spec Coverage
- root folder selection: Task 5
- config group dropdown and file search/list: Task 1 + Task 5
- XML open/save: Task 2
- XLSX open/save current sheet only: Task 3
- column checkbox visibility: Task 4 + Task 5
- edit existing values only: Task 5
- unsaved-change confirmation: Task 5
- quick-add entry: Task 6
- in-connection `配置表` tab below `API`: Task 6

### Placeholder Scan
- No `TBD`, `TODO`, or “similar to above” shortcuts remain.
- Each task lists exact files, explicit test commands, and concrete function/component names.

### Type Consistency
- Backend payload names are consistent: `ConfigGroupSummary`, `ConfigFileEntry`, `ConfigTableDocument`.
- Renderer request wrappers use the same action names as backend registration: `configRoot.scan`, `configGroup.files`, `configDocument.open`, `configDocument.save`.
- Sidebar tab name is consistently `config` and shared helper constant is `CONFIG_TABLE_TAB_ID = 'config-table'`.
