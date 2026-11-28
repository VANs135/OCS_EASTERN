// TTW 2.1a / 3.1a：01 剧本地图边缘补给源。
// 只收真正离开地图的公路/铁路边；特殊命名的城/边格按规则日期单独换手。

import type { Side } from '@ocs-eastern/series/state-types'
import type { TtwCampaignMapIndex } from '../import/campaign-map-index.ts'

export interface DnieperEdgeSupplySources {
  axis: readonly string[]
  soviet: readonly string[]
}

interface ParsedHex {
  panel: string
  col: number
  row: number
}

function parseHex(hex: string): ParsedHex | undefined {
  const match = /^([A-D])(\d+)\.(\d+)$/.exec(hex)
  if (!match) return undefined
  return { panel: match[1]!, col: Number(match[2]), row: Number(match[3]) }
}

function editionForTurn(turn: number) {
  if (turn < 5) return { korostenSoviet: false, b235Soviet: false, dSouthSoviet: false, rownoSoviet: false }
  if (turn < 30) return { korostenSoviet: false, b235Soviet: true, dSouthSoviet: false, rownoSoviet: false }
  if (turn < 32) return { korostenSoviet: true, b235Soviet: true, dSouthSoviet: false, rownoSoviet: false }
  if (turn < 40) return { korostenSoviet: true, b235Soviet: true, dSouthSoviet: true, rownoSoviet: false }
  return { korostenSoviet: true, b235Soviet: true, dSouthSoviet: true, rownoSoviet: true }
}

/**
 * 01 开局/任意回合的地图边缘补给源。
 * 2.1a：轴心北缘 A、西缘 A/C、南缘 C、1943 年 D 南缘、B2.35（仅 9 月）。
 * 3.1a：苏军 B/D 东缘、B 北缘 B16.35 以东、以及按日期换手的 B2.35/A50/A25 等。
 */
export function dnieperEdgeSupplySources(map: TtwCampaignMapIndex, turn: number): DnieperEdgeSupplySources {
  const edition = editionForTurn(turn)
  const axis = new Set<string>()
  const soviet = new Set<string>()

  for (const edge of map.openEdges) {
    if (!edge.road && !edge.rail) continue
    const parsed = parseHex(edge.hex)
    if (!parsed) continue
    const { panel, col, row } = parsed

    // 轴心：A 北缘按 Korosten/Rovno 换手日期向西收缩。
    if (panel === 'A' && row === 35) {
      if (turn < 30 || col < (edition.rownoSoviet ? 25 : 50)) axis.add(edge.hex)
      else soviet.add(edge.hex)
    }
    // 轴心：A/C 西缘、C 南缘、1943 年 D 南缘。
    if (panel === 'A' && col === 1) axis.add(edge.hex)
    if (panel === 'C' && (col === 1 || row === 0)) axis.add(edge.hex)
    if (panel === 'D' && row === 0 && !edition.dSouthSoviet) axis.add(edge.hex)
    // 苏军：B/D 东缘、B 北缘 B16.35 以东。
    if ((panel === 'B' || panel === 'D') && col === 62) soviet.add(edge.hex)
    if (panel === 'B' && row === 35 && col >= 16) soviet.add(edge.hex)
    if (panel === 'D' && row === 0 && edition.dSouthSoviet) soviet.add(edge.hex)
  }

  // 规则点名的非/半边缘格。A50.34 是 Korosten 城格；A50.35 由 A 北缘分割覆盖。
  const named = (hex: string, side: Side) => (side === 'axis' ? axis : soviet).add(hex)
  if (edition.korostenSoviet) {
    named('A50.34', 'soviet')
    named('A50.35', 'soviet')
  } else {
    named('A50.34', 'axis')
  }
  if (edition.b235Soviet) named('B2.35', 'soviet')
  else named('B2.35', 'axis')
  if (edition.rownoSoviet) {
    named('A25.35', 'soviet')
    named('A38.35', 'soviet')
    named('A42.35', 'soviet')
  }
  // 3.1a 明写“B 北缘 B16.35（含）以东”；该格本身是基准点。
  named('B16.35', 'soviet')

  return { axis: [...axis].sort(), soviet: [...soviet].sort() }
}
