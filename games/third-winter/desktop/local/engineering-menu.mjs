import { scorpionCanEngineerAt, scorpionStationaryCombatWorker } from '../../src/match/scorpion-engineering.ts'
import { scorpionSpPayment } from '../../src/match/scorpion-sp-payment.ts'

/** Suggest work at the clicked hex. The controller checks each order with the session before showing it. */
export function airfieldMenuChoices(state, side, hex, ids, selected, { assets: { map, catalog }, board }, add) {
  if (state.kind !== 'playing' || state.cursor.phase !== 'movement' || state.cursor.phasing !== side ||
    state.turn.weather.ground === 'thaw' || !hex || !ids.length) return
  const field = state.airBases.find((base) => base.hex === hex)
  if (field && field.side !== side) return

  const workerName = (id) => catalog.definitions.get(state.units[id]?.definition)?.source.name ?? id
  const reduce = (unitIds, using) =>
    add(`将 ${hex} 的机场降低一级${using}`, 'work-airfield', { operation: 'reduce', hex, unitIds })
  const local = ids.filter((id) => {
    const unit = scorpionStationaryCombatWorker(state, side, id)
    return selected.includes(id) && unit?.hex === hex && !unit.disorganized
  })
  if (field?.level > 1 && local.length > 1) reduce(local, ' · 选中的同格单位')

  for (const id of ids) {
    const worker = scorpionStationaryCombatWorker(state, side, id)
    if (!worker) continue
    const engineer = scorpionCanEngineerAt(state, side, id, hex, map)
    const localRe = worker.hex === hex && !worker.disorganized && worker.printedRe - worker.stepsLost >= 1
    const using = ids.length > 1 ? ` · ${workerName(id)}` : ''
    if (field?.level > 1 && (engineer || localRe)) reduce([id], using)
    if (!engineer || field?.level >= 3) continue

    const ledger = scorpionSpPayment(state, side, map, board.supplyRail)
    const sources = ledger.available([worker])
    const build = (operation, label, cost) => {
      for (const first of sources) {
        let remaining = cost
        const payments = []
        for (const { dumpId, tokens } of [first, ...sources.filter((source) => source !== first)]) {
          const spend = Math.min(remaining, tokens)
          payments.push({ dumpId, tokens: spend })
          remaining -= spend
          if (!remaining) break
        }
        if (remaining) continue
        const from = payments.map(({ dumpId, tokens }) => {
          const source = ledger.source(dumpId)
          return `${source.hex} ${source.truck ? '运输点' : '补给堆'} ${tokens}T`
        }).join(' + ')
        add(`${label} ${hex}${using} · ${from}`, 'work-airfield', { operation, hex, unitIds: [id], payments })
      }
    }
    build('build', field ? '升级机场' : '修建机场', field?.strip ? 3 : 4)
    if (side === 'axis' && !field) build('build-strip', '修建简易跑道', 1)
  }
}
