import type { Side } from '@ocs-eastern/series/state-types'
import { scorpionAirstripPool } from '../match/scorpion-airfield-work.ts'
import { scorpionKesselSlots } from '../match/scorpion-kessel.ts'
import { scorpionReserveStock } from '../match/scorpion-reserves.ts'
import { currentScorpionTurn } from '../match/scorpion-round.ts'
import { scorpionFirstTurn } from '../match/scorpion-session.ts'
import type { ScorpionSession } from '../match/scorpion-session.ts'
import type { ScorpionSetupAssets } from '../match/scorpion-setup.ts'
import { scorpionDates } from '../ttw/scorpion/weather.ts'
import type { HexCounter } from './scorpion-map-counters.ts'

// Image files stay in the player's local data directory.
export const auxiliaryCardFiles = [
  { id: 'axis-off-map', label: '轴心离图盒', asset: 'Axis Off Map.jpg', width: 977, height: 913 },
  { id: 'turn-weather', label: '回合与天气', asset: 'Turn Record b.jpg', width: 966, height: 715 },
  { id: 'axis-dead', label: '轴心死人堆', asset: 'Axis Dead Pile .jpg', width: 976, height: 685 },
  { id: 'soviet-dead', label: '苏军死人堆', asset: 'Soviet Dead Pile.jpg', width: 963, height: 677 },
  { id: 'axis-breakdowns', label: '轴心拆分', asset: 'Axis Breakdowns.jpg', width: 1208, height: 708, reference: true },
  { id: 'soviet-breakdowns', label: '苏军拆分', asset: 'Soviet Breakdowns.jpg', width: 1208, height: 714, reference: true },
  { id: 'axis-formations-1', label: '轴心编队 1', asset: 'Axis MUF Display-1 (70).jpg', width: 1137, height: 1459, reference: true },
  { id: 'axis-formations-2', label: '轴心编队 2', asset: 'Axis MUF Display-2 (70).jpg', width: 1138, height: 1458, reference: true },
  { id: 'soviet-formations-1', label: '苏军编队 1', asset: 'Soviet MUF Display-1 (70).jpg', width: 1137, height: 1459, reference: true },
  { id: 'soviet-formations-2', label: '苏军编队 2', asset: 'Soviet MUF Display -2 (70).jpg', width: 1137, height: 1459, reference: true },
  { id: 'soviet-rvgk', label: '苏军战略预备', asset: 'Soviet RVGK.jpg', width: 963, height: 848, reference: true },
  { id: 'axis-supply-1', label: '轴心补给堆 1', asset: 'Supply_Dumps_Page.png', width: 965, height: 700, reference: true },
  { id: 'axis-supply-2', label: '轴心补给堆 2', asset: 'Supply_Dumps_Page2.png', width: 965, height: 700, reference: true },
  { id: 'rail-sea-cap', label: '铁路与海运', asset: 'Rail-Sea-Cap.png', width: 807, height: 332 },
] as const

type Catalog = ScorpionSetupAssets['catalog']
interface AidPiece extends Pick<HexCounter, 'id' | 'asset' | 'label' | 'badges'> {
  x: number
  y: number
  size: number
}
type Caption = { x: number; y: number; text: string }
type Card = { counters: AidPiece[]; captions: Caption[] }
type Inventory = { cell: number; counters: readonly Pick<AidPiece, 'id' | 'label' | 'asset'>[] }

export function scorpionAuxiliaryCardViews(state: Readonly<ScorpionSession>, catalog: Catalog, inventories: readonly Inventory[]) {
  const board = state.kind === 'playing' ? state : state.opening
  const active = state.kind === 'playing'
  const turn = active ? currentScorpionTurn(state.turn, state.turn.step.kind === 'player-turn' ? state : undefined) : scorpionFirstTurn()
  const axis = reservePool('axis', state, catalog)
  const soviet = reservePool('soviet', state, catalog)
  const playerTurn = active && turn.step.kind === 'player-turn' ? (state.cursor.phasing === state.cursor.first ? 1 : 2) : undefined
  const track = turnTrack(turn, catalog, playerTurn)

  for (const { key, source } of scorpionAirstripPool({ airBases: active ? state.airBases : [] }, catalog)) {
    const slot = Number(source.name.slice('Air Strip '.length)) - 1
    const asset = source.faces.combat?.asset
    if (asset && slot >= 0 && slot < 6) axis.counters.push({
      id: `airstrip:${key}`, asset, label: `可用简易跑道 ${slot + 1}`, x: 183 + slot * 75, y: 438, size: 54,
    })
  }

  for (const { definition, index, asset, name, ready, id, dead, availableFromTurn } of scorpionKesselSlots(state, catalog)) {
    if (ready && asset) axis.counters.push({ id: `kessel-box:${definition}`, asset, label: `${name} · 可放置`, x: 219 + 74 * index, y: 729, size: 54 })
    if (!dead && !id && !ready && asset) {
      const date = scorpionDates[availableFromTurn - 1]
      if (date) track.counters.push({ id: `kessel-return:${definition}`, asset,
        label: `${name} · 第 ${availableFromTurn} 回合可用`, x: daySlot(date), y: 311 + 28 * index, size: 27 })
      else track.captions.push({ x: 100, y: 359 + index * 14, text: `${name} · 第 ${availableFromTurn} 回合可用（超出剧本）` })
    }
  }
  for (const [index, alert] of board.availableAlerts.entries()) {
    const source = catalog.definitions.get(alert.definition)?.source
    const asset = source?.faces.combat?.asset
    if (asset) axis.counters.push({ id: `alert-pool:${alert.id}`, asset, label: source.name,
      x: 418 + 75 * (index % 4), y: 595 + Math.floor(index / 4) * 75, size: 55 })
  }
  for (const [index, definition] of ['land:id:3999', 'land:id:4499'].entries()) {
    const asset = catalog.definitions.get(definition)?.source.faces.combat?.asset
    if (asset && !Object.values(board.units).some((unit) => unit.definition === definition)) {
      axis.counters.push({ id: `remnant-pool:${definition}`, asset, label: '可用德军残部营',
        x: 183 + index * 75, y: 317, size: 54 })
    }
  }
  if (active) {
    for (const [side, card] of [['axis', axis], ['soviet', soviet]] as const) {
      const value = state.pax?.[side] ?? 0
      addMarker(card, catalog, side === 'axis' ? 'German Pax Tracker' : 'Soviet Pax Tracker',
        `pax:${side}`, `人员补充点 ${value}`,
        value ? (side === 'axis' ? 255 : 265) + 82 * (Math.min(9, value) - 1) : side === 'axis' ? 54 : 58, 174, 32, value)
    }
  }
  return { 'axis-off-map': axis, 'soviet-off-map': soviet, 'turn-weather': track,
    'axis-dead': deadPile(inventories.find(({ cell }) => cell === 19)),
    'soviet-dead': deadPile(inventories.find(({ cell }) => cell === 27)),
    'rail-sea-cap': { counters: [], captions: [{ x: 28, y: 276, text: '瓶中蝎：双方铁路运力 0，海运运力 0' }] } satisfies Card,
  }
}

function reservePool(side: Side, state: Readonly<ScorpionSession>, catalog: Catalog): Card {
  const axis = side === 'axis'
  const board = state.kind === 'playing' ? state : state.opening
  const count = Math.max(0, scorpionReserveStock(Object.values(board.units), side))
  const card: Card = { counters: [], captions: [] }
  for (let index = 0; index < count; index++) {
    addMarker(card, catalog, axis ? 'Axis Reserve' : 'Sov Reserve', `reserve:${side}:${index}`, '可用预备标记',
      (axis ? 256 : 196) + index * 93, axis ? 852 : 1176, 50)
  }
  addMarker(card, catalog, axis ? 'Axis Reserves Tracker' : 'Soviet Reserves Tracker', `reserve-count:${side}`,
    `剩余预备标记 ${count}`, 915, axis ? 852 : 1176, 57, count)
  return card
}

function turnTrack(turn: ReturnType<typeof scorpionFirstTurn>, catalog: Catalog, playerTurn?: number): Card {
  const card: Card = { counters: [], captions: [] }
  const date = scorpionDates[turn.number - 1]
  if (!date) return card
  const month = Number(date.slice(5, 7))
  addMarker(card, catalog, 'Year', 'track-year', date.slice(0, 4), 107, 120, 50, undefined, 'move')
  addMarker(card, catalog, 'Month', 'track-month', date.slice(0, 7), month === 1 ? 606 : 696, 113, 42)
  addMarker(card, catalog, 'Turn', 'track-turn', `第 ${turn.number} 回合 · ${date}`, daySlot(date), 324, 36)
  if (playerTurn) addMarker(card, catalog, 'Player Turn', 'track-player-turn', `第 ${playerTurn} 个玩家回合`,
    795, 219, 51, undefined, playerTurn === 2 ? 'move' : 'combat')
  addMarker(card, catalog, 'Ground', 'track-ground', turn.weather.ground === 'freeze' ? '冻结' : '解冻',
    turn.weather.ground === 'freeze' ? 547 : 631, 504, 43)
  addMarker(card, catalog, 'Flight', 'track-flight', { normal: '正常飞行', limited: '飞行受限', none: '禁飞' }[turn.weather.flight],
    { normal: 742, limited: 825, none: 909 }[turn.weather.flight], 659, 41)
  return card
}

function daySlot(date: string) {
  return 121 + [1, 5, 8, 12, 15, 19, 22, 26, 29].indexOf(Number(date.slice(-2))) * 90
}

function deadPile(inventory: Inventory | undefined): Card {
  const contents = inventory?.counters ?? []
  const columns = Math.max(1, Math.ceil(Math.sqrt(contents.length * 1.4)))
  const rows = Math.max(1, Math.ceil(contents.length / columns))
  const pitch = Math.min(76, 840 / columns, 480 / rows)
  return { counters: contents.map((counter, index) => ({ ...counter,
    x: 65 + pitch * (index % columns), y: 130 + pitch * Math.floor(index / columns), size: pitch - 6 })), captions: [] }
}

function addMarker(card: Card, catalog: Catalog, ref: string, id: string, label: string,
  x: number, y: number, size: number, number?: number, face: 'combat' | 'move' = 'combat') {
  const asset = catalog.aliases.get(ref)?.[0]?.source.faces[face]?.asset
  if (asset) card.counters.push({ id, label, asset, x, y, size,
    ...(number === undefined ? {} : { badges: [{ label, text: String(number) }] }) })
}
