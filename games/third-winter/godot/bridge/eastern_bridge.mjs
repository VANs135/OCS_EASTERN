// EASTERN → Godot 本机桥接：stdin/stdout 逐行 JSON。
// 只包装现有 openLocalScorpion/controller.dispatch/projectLocalScorpion，不改规则内核。
// 所有仓库内路径都从本文件位置推导；外部资料目录与 Node 可执行文件由 bridge.config.json 或环境变量给出。
import { createInterface } from 'node:readline'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const absolute = (value, base) => isAbsolute(value) ? value : resolve(base, value)

const engineDir = resolve(arg('engine-dir', resolve(here, '../../..')))
const dataRoot = absolute(arg('data-root', 'D:/war game/OCS各作数据库/OCS第三个冬天'), engineDir)
const tables = absolute(arg('tables', resolve(engineDir, 'dist')), engineDir)
const savePath = absolute(arg('save', 'E:/OCS/工作文件/eastern-godot-save.json'), engineDir)
const seed = Number(arg('seed', '20261127'))

const { openLocalScorpion, projectLocalScorpion } = await import(
  pathToFileURL(resolve(engineDir, 'games/third-winter/desktop/local/controller.mjs')).href)
const { loadLocalScorpion } = await import(
  pathToFileURL(resolve(engineDir, 'games/third-winter/desktop/local/data.mjs')).href)

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

let controller
try {
  const data = await loadLocalScorpion(dataRoot, tables)
  controller = await openLocalScorpion(data, savePath, seed)
  send({ id: 0, ok: true, bootstrap: true, model: data.model, view: projectLocalScorpion(controller.view()) })
} catch (error) {
  send({ id: 0, ok: false, bootstrap: true, error: error.message })
  process.exitCode = 1
}

if (controller) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let request
    try { request = JSON.parse(line) } catch { continue }
    if (request.kind === 'close') break
    const id = request.id ?? 0
    if (request.kind === 'ready') request.kind = 'view'
    try {
      const view = projectLocalScorpion(await controller.dispatch(request))
      send({ id, ok: true, view })
    } catch (error) {
      send({ id, ok: false, error: error.message })
    }
  }
  await controller.close()
}
