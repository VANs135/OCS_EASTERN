import { spawn } from 'node:child_process'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { openLocalScorpion, projectLocalScorpion } from './controller.mjs'
import { loadLocalScorpion } from './data.mjs'
import { readLocalJson, replaceLocalJson } from './store.mjs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const dist = join(root, 'dist')
const config = join(dist, 'scorpion-local', 'settings.json')
const flags = process.argv.slice(2)
const positions = flags.filter((value) => !value.startsWith('--'))
const option = (name) => flags.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)

async function main() {
  const smoke = flags.includes('--smoke')
  const previous = await readLocalJson(config)
  const path = positions[0] ?? previous?.root
  if (!path) throw new Error('首次启动请传入第三冬资料目录。此后可直接打开 start-scorpion.cmd。')
  const source = resolve(path)
  const unitRoot = positions[1] ?? (positions[0] === undefined ? previous?.unitRoot : undefined)
  const tables = resolve(option('tables') ?? previous?.tables ?? dist)
  const data = await loadLocalScorpion(source, tables, unitRoot ? resolve(unitRoot) : undefined)
  const temporary = await mkdtemp(join(tmpdir(), 'scorpion-local-'))
  let controller
  try {
    const defaultSave = data.schema === 'v2' ? 'continue-v2.json' : 'continue.json'
    const savePath = resolve(option('save') ?? (smoke ? join(temporary, 'test.json') : join(dist, 'scorpion-local', defaultSave)))
    controller = await openLocalScorpion(data, savePath)
    if (!smoke) await replaceLocalJson(config, { root: source, ...(unitRoot ? { unitRoot: resolve(unitRoot) } : {}), tables })
    const bootstrap = join(temporary, 'model.json')
    const view = projectLocalScorpion(controller.view())
    await writeFile(bootstrap, JSON.stringify({ ...data.model, frames: [view.frame], local: { ...view, savePath } }), 'utf8')
    await showNativeWindow(bootstrap, controller, smoke)
    if (smoke) {
      const saved = await readLocalJson(savePath)
      if (saved?.record.revision < 1) throw new Error('The native smoke test did not save a game command')
      console.log(`Native WPF smoke passed. Saved revision ${saved.record.revision}.`)
    }
  } finally {
    if (controller) await controller.close()
    await rm(join(temporary, 'model.json'), { force: true })
    if (smoke && !option('save')) await rm(join(temporary, 'test.json'), { force: true })
    await rmdir(temporary)
  }
}

async function showNativeWindow(bootstrap, controller, smoke) {
  const script = fileURLToPath(new URL('../CalibratedMap.ps1', import.meta.url))
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-ModelPath', bootstrap, '-Local']
  if (smoke) args.push('-LocalSmoke')
  if (smoke && option('smoke-image')) args.push('-LocalSmokeImage', resolve(option('smoke-image')))
  if (smoke && option('smoke-replay')) args.push('-LocalSmokeReplay', resolve(option('smoke-replay')))
  const window = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
  window.stdin.on('error', (error) => { if (error.code !== 'EPIPE') console.error(error.message) })
  const closed = new Promise((done, fail) => {
    window.once('error', fail)
    window.once('exit', (code) => code === 0 ? done() : fail(new Error(`Windows 窗口退出 (${code})`)))
  })
  const lines = createInterface({ input: window.stdout, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      let response
      try {
        const message = JSON.parse(line)
        if (message.kind === 'ready') {
          console.log('瓶中蝎本地窗口已打开')
          message.kind = 'view'
        }
        response = { ok: true, view: projectLocalScorpion(await controller.dispatch(message)) }
      } catch (error) { response = { ok: false, error: error.message } }
      window.stdin.write(`${JSON.stringify(response)}\n`)
    }
    await closed
  } finally { lines.close(); window.stdin.end() }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
