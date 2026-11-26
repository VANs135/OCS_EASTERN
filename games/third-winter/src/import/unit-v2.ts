import type { Side } from '@ocs-eastern/series/state-types'
import type { BackupFace, BackupUnit } from './unit-backup.ts'
import { unitCatalog } from './unit-catalog.ts'
import type { CatalogKind } from './unit-catalog.ts'

const tables = [
  ['units_inf_div.json', 'land', 'units'],
  ['units_hq.json', 'hq', 'units'],
  ['units_transport.json', 'transport', 'units'],
  ['units_air.json', 'aircraft', 'units'],
  ['units_air_army_hq.json', 'air-army-hq', 'units'],
  ['units_luftflotte_hq.json', 'luftflotte-hq', 'units'],
  ['units_formation.json', 'formation', 'units'],
  ['units_markers.json', 'marker', 'markers'],
] as const

/** Adapt the local TTW catalog to the existing runtime unit shape at the file boundary. */
export async function loadThirdWinterV2Units(readJson: (file: string) => Promise<unknown>) {
  const records = await Promise.all(tables.map(async ([file, kind, key]) => {
    const document = record(await readJson(file), file)
    const meta = record(document.meta, `${file}: meta`)
    const rows = document[key]
    if (meta.schema !== 'ocs-wargame-db-v2' || meta.game !== 'Third Winter' ||
      !Array.isArray(rows) || rows.length === 0 || meta.count !== rows.length) {
      throw new Error(`无效的第三冬 v2 算子库：${file}（检查版本、作品及 ${key} 条目数）`)
    }
    return { file, kind, rows: rows.map((row: unknown) => readUnit(row, kind, file)) }
  }))
  return unitCatalog(records)
}

function readUnit(value: unknown, kind: CatalogKind, file: string): BackupUnit {
  const row = record(value, file)
  if (typeof row.id !== 'string' || (!row.id.trim() && kind !== 'marker') ||
    typeof row.name !== 'string' || !row.name.trim()) {
    throw new Error(`无效的 v2 算子编号或名称：${file}`)
  }
  const label = `${file} · ${row.name}`
  const side = unitSide(row, kind, label)
  const nation = row.nation == null ? '' : typeof row.nation === 'string' ? row.nation.trim() : ''
  if (row.nation != null && !nation) throw new Error(`无效的算子国籍：${label}`)
  const abilities: unknown = row.abilities ?? []
  if (!Array.isArray(abilities) || !abilities.every((value: unknown) => typeof value === 'string')) {
    throw new Error(`无效的算子能力：${label}`)
  }
  const declaredAbilities: string[] = abilities
  const runtimeAbilities = new Set(declaredAbilities)
  if (row.instance_pool === 'alert' || row.alert_pool === true) runtimeAbilities.add('alert_battalion')
  if (kind === 'hq' && row.kessel === true) runtimeAbilities.add('kessel_supply')
  return {
    id: row.id, name: row.name, side, ...(nation ? { nation } : {}), re: numberField(row.RE, `${label} · RE`),
    category: row.combat_category === 'inf' ? 'infantry' : asString(row.combat_category) ?? undefined,
    ...(asString(row.hq_kind) ? { hqKind: asString(row.hq_kind)! } : {}),
    ...(row.rail_only === true ? { railOnly: true } : {}),
    ...(typeof row.rail_cap_RE === 'number' && Number.isFinite(row.rail_cap_RE) ? { railCapRe: row.rail_cap_RE } : {}),
    ...(row.must_be_city === true ? { mustBeCity: true } : {}),
    org: { parentFmt: asString(row.formation), airGroup: asString(row.air_group) },
    abilities: [...runtimeAbilities],
    ...(typeof row.multi_instance === 'boolean' ? { multiInstance: row.multi_instance } : {}),
    ...(typeof row.instance_pool === 'string' ? { instancePool: row.instance_pool } : {}),
    faces: {
      combat: readFace(row.front, row.defensiveOnly === true, `${label} · front`),
      move: readFace(row.back, row.defensiveOnly === true, `${label} · back`),
    },
  }
}

function unitSide(row: Record<string, unknown>, kind: CatalogKind, label: string): Side | null {
  if (row.faction === 'AXIS') return 'axis'
  if (row.faction === 'SOV') return 'soviet'
  if (row.faction === null && kind === 'marker') {
    // Allied and Neutral markers have no exclusive owner in the runtime catalog.
    if (row.side === 'Axis') return 'axis'
    if (row.side === 'Soviet') return 'soviet'
    return null
  }
  throw new Error(`无效的算子阵营：${label}`)
}

function readFace(value: unknown, defensiveOnly: boolean, label: string): BackupFace | null {
  if (value == null) return null
  const face = record(value, label)
  const attack = asString(face.A)
  const move = asString(face.MA)
  const stat = (key: string) => numberField(face[key], `${label} · ${key}`)
  return {
    asset: asString(face.file),
    maColor: asString(face.ma_color),
    stats: {
      attack: stat('A'), artRange: stat('AR'),
      move: move === '-' || move === 'rr' ? null : stat('MA'),
      barrage: stat('barrage'), range: stat('range'), aaMod: asString(face.aa_mod),
      dropRange: stat('drop_range'), transport: stat('transport'),
      airCombat: stat('air_combat'), bombing: stat('bombing'),
      defensiveOnly: face.defensive_only === true || defensiveOnly || attack?.startsWith('(') === true,
    },
  }
}

function numberField(raw: unknown, label: string): number | null {
  if (raw == null || raw === '') return null
  if (raw === '1/2') return 0.5
  if (typeof raw === 'string') {
    const value = raw.replace(/^\((.+)\)$/, '$1')
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value)
  }
  throw new Error(`无效的算子数值：${label}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`无效的 v2 数据对象：${label}`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null
}
