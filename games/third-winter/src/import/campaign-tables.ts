import type { BarrageTable } from '@ocs-eastern/series/tables/barrage'
import { CRT_TERRAIN_TYPES } from '@ocs-eastern/series/tables/crt'
import type { CrtLike } from '@ocs-eastern/series/tables/crt'

/**
 * 战役战斗/炮击表导入（通规 v4.3 图表实值，G15 口径）。
 * 实值 JSON 由 scripts/export-v43-*.py 从 OCS_Chartsv4.3.pdf 抽取并随库提交
 * （data/scorpion-real-library/tables/ocs-v43-*.json）；本模块只做结构校验与类型收敛，
 * 不改写、不推定任何表值。瓶中蝎与全景战役共用同一份实值。
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/** 校验 CRT：四类地形列位齐全、odds 标签可解析、矩阵与行/列维度一致。 */
export function parseCampaignCrt(source: unknown): CrtLike {
  if (!isRecord(source) || !isStringArray(source.diceRows) || !source.diceRows.length ||
    !isRecord(source.terrainColumns) || !Array.isArray(source.matrix)) {
    throw new Error('Invalid CRT table: expected diceRows, terrainColumns and matrix')
  }
  const terrainColumns: Record<string, readonly string[]> = {}
  for (const terrain of CRT_TERRAIN_TYPES) {
    const labels = source.terrainColumns[terrain]
    if (!isStringArray(labels) || !labels.length || labels.some((label) => !/^\d+:\d+$/.test(label))) {
      throw new Error(`Invalid CRT table: missing or malformed odds columns for ${terrain}`)
    }
    terrainColumns[terrain] = labels
  }
  const width = terrainColumns[CRT_TERRAIN_TYPES[0]!]!.length
  if (Object.values(terrainColumns).some((labels) => labels.length !== width)) {
    throw new Error('Invalid CRT table: terrain column counts disagree')
  }
  const matrix = source.matrix
  if (matrix.length !== source.diceRows.length ||
    matrix.some((row) => !isStringArray(row) || row.length !== width)) {
    throw new Error('Invalid CRT table: matrix dimensions disagree with diceRows/columns')
  }
  return { diceRows: source.diceRows, terrainColumns, matrix: matrix as readonly (readonly string[])[] }
}

/** 校验炮击表：列位/补给成本/矩阵维度一致；地面表 11 行（2d6 的 2–12），设施表 6 行（1d6）。 */
export function parseCampaignBarrage(source: unknown, diceRows = 11): BarrageTable {
  if (!isRecord(source) || !isStringArray(source.columns) || !source.columns.length ||
    !Array.isArray(source.costs) || !Array.isArray(source.matrix)) {
    throw new Error('Invalid barrage table: expected columns, costs and matrix')
  }
  const costs = source.costs
  if (costs.length !== source.columns.length ||
    costs.some((cost) => !Number.isSafeInteger(cost) || (cost as number) < 1)) {
    throw new Error('Invalid barrage table: costs must match columns and be positive integers')
  }
  const columns = source.columns
  const matrix = source.matrix
  if (matrix.length !== diceRows || matrix.some((row) => !isStringArray(row) || row.length !== columns.length)) {
    throw new Error(`Invalid barrage table: matrix must be ${diceRows} dice rows by column count`)
  }
  return { columns, costs: costs as readonly number[], matrix: matrix as readonly (readonly string[])[] }
}

/** 装配战役三表（设施表可选），供战斗/炮击环绑定层注入。 */
export function loadCampaignTables(input: { crt: unknown; barrage: unknown; facility?: unknown }):
  { crt: CrtLike; barrage: BarrageTable; facility?: BarrageTable } {
  return {
    crt: parseCampaignCrt(input.crt),
    barrage: parseCampaignBarrage(input.barrage),
    ...(input.facility === undefined ? {} : { facility: parseCampaignBarrage(input.facility, 6) }),
  }
}