const { spawnSync } = require('child_process')
const path = require('path')

function resolveGoCommand() {
  if (process.env.GO_EXECUTABLE) {
    return process.env.GO_EXECUTABLE
  }
  if (process.env.GOROOT) {
    return path.join(process.env.GOROOT, 'bin', process.platform === 'win32' ? 'go.exe' : 'go')
  }
  return process.platform === 'win32' ? 'go.exe' : 'go'
}

const serverDir = path.resolve(__dirname, '..', '..', 'server')
const outputName = process.platform === 'win32' ? 'flow-packet.exe' : 'flow-packet'
const outputPath = path.join(serverDir, outputName)
const goCommand = resolveGoCommand()

function beforeBuild() {
  const result = spawnSync(goCommand, ['build', '-o', outputPath, './cmd/flow-packet'], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    throw result.error
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
}

exports.default = beforeBuild

if (require.main === module) {
  try {
    beforeBuild()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
