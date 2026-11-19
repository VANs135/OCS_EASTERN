import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { verifyRngState } from '@ocs-eastern/series/rng'

export async function replaceLocalJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const pending = join(dirname(path), `.scorpion-${randomUUID()}.tmp`)
  try {
    await writeFile(pending, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', flush: true })
    await rename(pending, path)
  } finally {
    await unlink(pending).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
}

export async function readLocalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

// A second local window must not write the same match.
export async function lockLocalSave(path) {
  await mkdir(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  let handle
  try {
    handle = await open(lockPath, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    handle = await recoverLocalLock(lockPath)
  }
  try {
    await handle.writeFile(String(process.pid))
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(lockPath)
    throw error
  }
  let closed = false
  return async () => {
    if (closed) return
    closed = true
    await handle.close()
    await unlink(lockPath)
  }
}

async function lockOwnerIsGone(path) {
  const pid = Number(await readFile(path, 'utf8'))
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0) } catch (error) { return error.code === 'ESRCH' }
  return false
}

async function recoverLocalLock(path) {
  const busy = new Error(`存档正在使用，请关闭上一窗口再重试。锁文件 ${path}`)
  if (!await lockOwnerIsGone(path)) throw busy
  const recoveryPath = `${path}.recover`
  const recovery = await open(recoveryPath, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw busy
    throw error
  })
  try {
    if (!await lockOwnerIsGone(path)) throw busy
    await unlink(path)
    return await open(path, 'wx').catch((error) => {
      if (error.code === 'EEXIST') throw busy
      throw error
    })
  } finally {
    await recovery.close()
    await unlink(recoveryPath)
  }
}

export function restoreLocalScorpion(saved, { fingerprint, assets }) {
  if (!saved || saved.version !== 1 || saved.scenario !== 'scorpion' || saved.fingerprint !== fingerprint) {
    throw new Error('存档的剧本、版本或本机资料与当前对局不同。原存档已保留。')
  }
  const record = saved.record
  const state = record?.state
  if (!Number.isSafeInteger(record?.revision) || record.revision < 0 || !Array.isArray(record.receipts) ||
    record.receipts.length !== record.revision || record.receipts.some((receipt, index) => receipt?.revision !== index + 1) ||
    !['setup', 'playing'].includes(state?.kind)) throw new Error('存档的对局记录不完整')
  const board = state.kind === 'playing' ? state : state.opening
  const { catalog, map } = assets
  if (!board?.rng || !verifyRngState(board.rng) || !board.units || !Array.isArray(board.pieces) ||
    Object.values(board.units).some((unit) => !catalog.definitions.has(unit?.definition) || !map.hexes.has(unit?.hex)) ||
    board.pieces.some((piece) => !catalog.definitions.has(piece?.definition) || !piece.location ||
      (piece.location.kind === 'hex' && !map.hexes.has(piece.location.hex)))) throw new Error('存档中的骰序、算子或格号无法恢复')
  if (state.reroll?.current && !verifyRngState(state.reroll.current.draw.rng)) throw new Error('待决重掷的骰序无法恢复')
  return record
}

export function localScorpionEnvelope(record, fingerprint) {
  return { version: 1, scenario: 'scorpion', fingerprint, record }
}
