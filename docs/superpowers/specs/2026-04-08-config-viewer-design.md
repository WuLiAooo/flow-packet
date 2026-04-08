# Config Viewer / Editor Design

## Goal
Build a local configuration table viewer and editor for `C:\top-hero\Meta`.

The feature must let users:
- choose a root folder
- choose a config group
- search and open an `xml` or `xlsx` file in that group
- inspect columns and all rows in a table view
- hide selected columns via column checkboxes
- edit existing cell values only
- save back to the currently opened source only
- confirm before switching context when there are unsaved changes
- enter the feature from 2 UI entry points

## Scope
In scope:
- local folder scanning
- group discovery and pairing
- XML table reading/writing
- XLSX sheet reading/writing
- file search within a selected group
- column visibility filtering
- editable table cells
- save for current XML or current XLSX sheet
- dirty-state confirmation dialog

Out of scope:
- automatic XML/XLSX synchronization
- add/delete rows
- add/delete columns
- edit column names
- schema validation beyond basic file-format checks
- bulk import/export workflows

## Directory Assumptions
Root folder example: `C:\top-hero\Meta`

Per group layout:
- Excel folder: `meta_xxx`
- XML folder: `meta_xxx_xml`

Grouping rule:
- `meta_xxx` and `meta_xxx_xml` are treated as one logical config group
- the logical group key is `meta_xxx`

## User Experience
### Entry Points
The feature is reachable from 2 places:
- below the existing quick-add entry area
- after entering a connection, as a new `配置表` tab placed below the existing `API` tab

Rules:
- both entry points open the same configuration-table experience
- both entry points share the same backend and document model
- the connection-page entry must not depend on the API tab's game-service state

### Left Sidebar
Top to bottom:
- root folder selector
- config group dropdown
- searchable file list for the selected group

Behavior:
- root folder defaults to the last successful folder, or a configured default when available
- once the root folder is selected, the app scans and loads config groups
- once a config group is selected, the file list shows all XML and XLSX files for that group
- same-name XML/XLSX files are both shown independently if they exist
- each file item displays a type badge: `XML` or `XLSX`
- the file search filters only the current group's file list

### Main Area
Top to bottom:
- current file title and save controls
- sheet selector for XLSX only
- column checkbox area, default all checked
- editable data table

Behavior:
- selecting an XML file opens it directly
- selecting an XLSX file opens the first sheet by default
- switching sheet reloads that sheet's columns and rows
- unchecking a column hides it in the table only; it does not remove or clear underlying data
- table supports editing existing cell values only
- save writes back only the current XML file or the current XLSX file's current sheet

## Data Model
### Group Summary
- `groupKey: string`
- `excelDirPath?: string`
- `xmlDirPath?: string`
- `displayName: string`

### File Entry
- `id: string`
- `groupKey: string`
- `sourceType: 'xml' | 'xlsx'`
- `fileName: string`
- `filePath: string`

### Open Document
- `sourceType: 'xml' | 'xlsx'`
- `filePath: string`
- `fileName: string`
- `sheetName?: string`
- `sheetNames?: string[]`
- `columns: string[]`
- `rows: Record<string, string>[]`
- `dirty: boolean`

### UI State
- selected root folder
- selected group
- file search keyword
- selected file
- selected sheet for XLSX
- hidden columns set
- current document dirty state
- pending navigation target when confirm dialog is open

## Parsing Rules
### XML
Supported XML shape:
- one root node representing the table
- repeated child nodes representing rows
- row data stored on child-node attributes

Example:
- root: `active_rules`
- row tag: `active_rule`
- columns: attribute names such as `id`, `groupid`, `severtime`

Read strategy:
- infer row tag from repeated direct children under the root
- collect the union of attribute names across all row nodes as columns
- each row is serialized into string values per column
- missing attributes become empty strings in the table model

Write strategy:
- preserve XML declaration
- preserve root node name
- preserve row node name
- rewrite row attributes from the edited table model
- do not introduce new rows or new attributes beyond existing table columns unless they already exist in the document model

### XLSX
Assumptions:
- first row is the header row
- remaining rows are data rows
- one file can contain multiple sheets

Read strategy:
- load all sheet names
- open first sheet by default
- columns come from the first row of the current sheet
- rows come from subsequent rows mapped to those columns
- missing cells become empty strings in the table model

Write strategy:
- update only the current sheet
- keep all other sheets unchanged
- write edited values back to existing row/column positions
- preserve workbook structure as much as the library allows

## Backend Design
Use the existing Go backend for all filesystem access and document parsing.

Recommended backend responsibilities:
- scan root folder and discover groups
- list files for a selected group
- open XML or XLSX documents as a unified table payload
- save edited XML or XLSX data
- enforce path safety so reads/writes stay under the selected root folder

Recommended actions:
- `configRoot.scan`
- `configGroup.files`
- `configDocument.open`
- `configDocument.save`

## Frontend Design
Renderer responsibilities:
- expose the feature in both required entry points
- folder selection UI
- group dropdown UI
- file search and file list UI
- sheet selector UI for XLSX
- column visibility controls
- editable data grid
- dirty-state tracking
- save flow and feedback
- unsaved-change confirmation dialog

A reusable table component should receive:
- visible columns
- row data
- edit callbacks
- read-only constraints for unsupported cases

## Unsaved Changes
When the current document is dirty and the user attempts to switch:
- root folder
- config group
- file
- XLSX sheet

Show a confirm dialog with 3 actions:
- save and switch
- discard and switch
- cancel

Rules:
- save and switch: save current document first, then navigate
- discard and switch: drop current in-memory edits, then navigate
- cancel: keep current document open and unchanged

Dirty state granularity:
- XML: per opened file
- XLSX: per opened file + current sheet only

## Error Handling
User-facing errors should stay concise.

Messages:
- root folder load failure: `加载配置目录失败`
- group scan failure: `加载配置组失败`
- file list failure: `加载文件列表失败`
- document open failure: `打开文件失败`
- save failure: `保存失败`
- unsupported XML shape: `当前 XML 结构不支持表格化展示`
- invalid XLSX header: `当前 Sheet 缺少有效表头`

Avoid exposing raw stack traces or low-level parser noise in normal UI toasts.

## Validation and Safety
- only allow read/write under the chosen root folder
- reject path traversal
- normalize file paths before access
- disable save when no document is open
- disable save when there are no changes
- prompt before dropping dirty state
- treat all edited values as strings unless future schema metadata is introduced

## Libraries
### Go
Add libraries for:
- XLSX read/write
- XML parsing and serialization

XML can be handled with standard library if the chosen structure is simple enough, but a helper library is acceptable if attribute-preserving writes become cumbersome.

### React
The current project already has table-oriented UI capability. Reuse existing table primitives and patterns where practical.

## Recommended Rollout
1. Backend group scanning and file listing
2. XML open + table render
3. XLSX open + sheet selector
4. Editable cell model
5. XML save + XLSX sheet save
6. Column visibility controls
7. Unsaved-change confirmation flow
8. Polish and error handling

## Open Decisions Resolved
- Excel files are `.xlsx`
- XML and XLSX are not auto-synced
- saving writes only to the currently opened source
- same-name XML/XLSX files are both shown if present
- XLSX supports multiple sheets
- save affects only the current sheet
- editing is limited to existing values
- unsaved changes use a confirmation dialog
