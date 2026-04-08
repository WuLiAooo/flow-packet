import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_TABLE_TAB_ID,
  buildConfigTableStats,
  buildVisibleColumns,
  createDocumentSnapshot,
  decidePendingNavigation,
  filterConfigFiles,
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

test('decidePendingNavigation requests confirmation only when current document is dirty', () => {
  assert.deepEqual(
    decidePendingNavigation(false, { type: 'file', value: 'a.xml' }),
    { allow: true, pending: null }
  )
  assert.deepEqual(
    decidePendingNavigation(true, { type: 'file', value: 'a.xml' }),
    { allow: false, pending: { type: 'file', value: 'a.xml' } }
  )
})

test('buildConfigTableStats returns compact status values for the header strip', () => {
  assert.deepEqual(
    buildConfigTableStats({ columns: ['id', 'name'], rows: [{ id: '1', name: 'a' }] }, 1, true),
    [
      { label: '列', value: '2' },
      { label: '行', value: '1' },
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

test('config table tab id is stable for both entry points', () => {
  assert.equal(CONFIG_TABLE_TAB_ID, 'config-table')
})
