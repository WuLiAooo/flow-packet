const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const packageJson = require(path.join('..', 'package.json'))

test('package scripts expose win and mac pack commands', () => {
  assert.equal(packageJson.scripts.pack, 'npm run build:all && electron-builder')
  assert.equal(packageJson.scripts['pack:win'], 'npm run build:all && electron-builder --win')
  assert.equal(packageJson.scripts['pack:mac'], 'npm run build:all && electron-builder --mac')
  assert.equal(packageJson.scripts['build:backend'], 'node scripts/build-backend.cjs')
})

test('electron-builder resources include both win and mac backend binaries', () => {
  assert.deepEqual(packageJson.build.extraResources, [
    {
      from: '../server',
      to: 'go-backend',
      filter: ['flow-packet', 'flow-packet.exe'],
    },
  ])
})

test('electron-builder has both win and mac targets configured', () => {
  assert.deepEqual(packageJson.build.win, {
    target: 'nsis',
    icon: 'build/icon.ico',
  })

  assert.deepEqual(packageJson.build.mac, {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
  })
})
