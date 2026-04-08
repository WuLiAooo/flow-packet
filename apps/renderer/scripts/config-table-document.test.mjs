import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_TABLE_ALL_COLUMNS,
  CONFIG_TABLE_TAB_ID,
  DEFAULT_CONFIG_TABLE_PAGE_SIZE,
  buildConfigSaveRequest,
  buildConfigTableStats,
  buildVisibleColumns,
  decidePendingNavigation,
  filterConfigFiles,
  getConfigRowIDValue,
  hasEditedRows,
  mergeConfigRows,
} from '../src/components/config-table/configTableDocument.js'

test('buildVisibleColumns removes hidden columns only from presentation', () => {
  assert.deepEqual(
    buildVisibleColumns(['id', 'name', 'level'], new Set(['name'])),
    ['id', 'level']
  )
})

test('mergeConfigRows overlays edited row values onto the currently loaded page', () => {
  const rows = [
    { rowIndex: 1, values: { id: '2', name: 'boss_reward', groupid: '20' } },
  ]
  const editedRows = new Map([
    [1, { id: '2', name: 'boss_reward_new', groupid: '20' }],
  ])

  assert.deepEqual(mergeConfigRows(rows, editedRows), [
    { rowIndex: 1, values: { id: '2', name: 'boss_reward_new', groupid: '20' } },
  ])
})

test('buildConfigSaveRequest converts edited rows into sorted row patches', () => {
  assert.deepEqual(
    buildConfigSaveRequest(
      {
        sourceType: 'xlsx',
        filePath: 'C:/meta.xlsx',
        sheetName: 'Rules',
        columns: ['id', 'name'],
      },
      new Map([
        [4, { id: '5', name: 'delta' }],
        [1, { id: '2', name: 'boss' }],
      ])
    ),
    {
      sourceType: 'xlsx',
      filePath: 'C:/meta.xlsx',
      sheetName: 'Rules',
      columns: ['id', 'name'],
      rowPatches: [
        { rowIndex: 1, values: { id: '2', name: 'boss' } },
        { rowIndex: 4, values: { id: '5', name: 'delta' } },
      ],
    }
  )
})

test('hasEditedRows detects whether there are unsaved row patches', () => {
  assert.equal(hasEditedRows(new Map()), false)
  assert.equal(hasEditedRows(new Map([[0, { id: '1' }]])), true)
})

test('decidePendingNavigation requests confirmation only when there are unsaved edits', () => {
  assert.deepEqual(
    decidePendingNavigation(false, { type: 'file', value: 'a.xml' }),
    { allow: true, pending: null }
  )
  assert.deepEqual(
    decidePendingNavigation(true, { type: 'file', value: 'a.xml' }),
    { allow: false, pending: { type: 'file', value: 'a.xml' } }
  )
})

test('buildConfigTableStats uses total rows for the compact header strip', () => {
  assert.deepEqual(
    buildConfigTableStats({ columns: ['id', 'name'], totalRows: 320 }, 1, true),
    [
      { label: '列', value: '2' },
      { label: '行', value: '320' },
      { label: '显示', value: '1' },
      { label: '状态', value: '未保存' },
    ]
  )
})

test('filterConfigFiles splits xml and xlsx lists and matches compact search text', () => {
  const files = [
    { id: '1', sourceType: 'xml', fileName: 'active_rules.xml', filePath: 'a' },
    { id: '2', sourceType: 'xml', fileName: 'role_reward.xml', filePath: 'b' },
    { id: '3', sourceType: 'xlsx', fileName: 'active_rules.xlsx', filePath: 'c' },
  ]

  assert.deepEqual(
    filterConfigFiles(files, 'xml', '').map((file) => file.id),
    ['1', '2']
  )
  assert.deepEqual(
    filterConfigFiles(files, 'xml', 'active rules').map((file) => file.id),
    ['1']
  )
  assert.deepEqual(
    filterConfigFiles(files, 'xlsx', 'active_rules').map((file) => file.id),
    ['3']
  )
})

test('getConfigRowIDValue returns the row id for the sticky first column', () => {
  assert.equal(getConfigRowIDValue({ rowIndex: 3, values: { id: '1001', name: 'boss' } }), '1001')
})

test('config table constants stay stable for shared entry points and search defaults', () => {
  assert.equal(CONFIG_TABLE_TAB_ID, 'config-table')
  assert.equal(CONFIG_TABLE_ALL_COLUMNS, '__all__')
  assert.equal(DEFAULT_CONFIG_TABLE_PAGE_SIZE, 200)
})
