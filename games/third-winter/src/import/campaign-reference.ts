import type { Side } from '@ocs-eastern/series/state-types'
import type { BackupUnit } from './unit-backup.ts'
import type { Definition } from './unit-catalog.ts'

export type CampaignAliases = ReadonlyMap<string, readonly Definition<BackupUnit>[]>
export type CampaignReferenceIssue = 'ambiguous' | 'wrong-side' | 'missing'

export function resolveCampaignReference(aliases: CampaignAliases, ref: string, side: Side):
  { definition: Definition<BackupUnit> } | { issue: CampaignReferenceIssue } {
  const definitions = aliases.get(ref) ?? []
  const friendly = definitions.filter(({ kind, source }) => source.side === side || (kind === 'marker' && source.side === null))
  if (friendly.length === 1) return { definition: friendly[0]! }
  return { issue: friendly.length > 1 ? 'ambiguous' : definitions.length ? 'wrong-side' : 'missing' }
}
