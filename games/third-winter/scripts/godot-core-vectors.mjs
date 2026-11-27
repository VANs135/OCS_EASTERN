import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { acceptCommand } from '@ocs-eastern/match-core/command-log'
import {
  createRngState, nextFloat, nextUint32, pickIndex, replayFrom, roll1d6, roll2d6,
} from '@ocs-eastern/series/rng'

const directory = new URL('../godot/tests/vectors/', import.meta.url)
const seeds = [0, 42, 20260913, 0xffffffff, -7.8]
const rng = seeds.map((seed) => {
  const initial = createRngState(seed)
  let current = initial
  const uint32 = Array.from({ length: 100 }, () => {
    const { value, rng } = nextUint32(current)
    current = rng
    return value
  })
  const first = roll1d6(initial)
  return { seed, initial, uint32, after: current, fraction: nextFloat(initial), first, second: roll2d6(first.rng),
    picks: [1, 6, 0x80000001, 0x100000000].map((size) => ({ size, draw: pickIndex(initial, size) })),
    jumps: [0, 11, 2 ** 32 + 11, Number.MAX_SAFE_INTEGER].map((count) => replayFrom(seed, count)) }
})
assert.ok(rng.some(({ picks }) => picks.some(({ draw }) => draw.rng.drawCount > 1)), 'Fixture must exercise rejection sampling')

const initial = { state: { actor: 'axis', pieces: { test: { hex: 'A1.01' } }, rng: createRngState(42) }, revision: 0, receipts: [] }
let record = initial
const steps = []
const errorCodes = { 'Stale match revision': 'stale_revision', 'Wrong actor': 'wrong_actor', 'Illegal target': 'illegal_target' }

function submit(label, side, id, expectedRevision, action) {
  const command = { id, expectedRevision, action }
  let expected
  try {
    const accepted = acceptCommand(record, side, command, (state, seat, move) => {
      if (seat !== state.actor) throw new Error('Wrong actor')
      const draw = nextUint32(state.rng)
      if (!['A1.02', 'A1.03'].includes(move.hex)) throw new Error('Illegal target')
      return { actor: seat === 'axis' ? 'soviet' : 'axis', pieces: { test: { hex: move.hex } }, rng: draw.rng }
    })
    record = accepted.record
    expected = { ok: true, value: accepted }
  } catch (error) {
    const errorCode = errorCodes[error.message]
    if (!errorCode) throw error
    expected = { ok: false, errorCode }
  }
  steps.push({ label, side, command, expected, record })
}

submit('登记录入', 'axis', 'move-1', 0, { type: 'move', hex: 'A1.02' })
submit('重试优先于过期修订', 'axis', 'move-1', 0, { type: 'move', hex: 'illegal' })
submit('新命令修订过期', 'soviet', 'move-2', 0, { type: 'move', hex: 'A1.03' })
submit('错方', 'axis', 'move-2', 1, { type: 'move', hex: 'A1.03' })
submit('计算骰序后拒绝非法目标', 'soviet', 'move-2', 1, { type: 'move', hex: 'illegal' })
submit('另一席位可复用同一个 ID', 'soviet', 'move-1', 1, { type: 'move', hex: 'A1.03' })
submit('较早的回执保留原修订', 'axis', 'move-1', 0, { type: 'move', hex: 'A1.02' })

const files = { 'rng.json': rng, 'command_log.json': { initial, steps } }
const check = process.argv.includes('--check')
await mkdir(directory, { recursive: true })
for (const [name, vectors] of Object.entries(files)) {
  const file = new URL(name, directory)
  const expected = JSON.stringify(vectors) + '\n'
  if (check) assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), vectors, `${name} 与 TypeScript 基线不一致`)
  else await writeFile(file, expected)
}
console.log(check ? 'Godot 基础向量与 TypeScript 一致。' : '已生成 Godot 基础向量。')
