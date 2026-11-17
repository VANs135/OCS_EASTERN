export interface Command<C> {
  id: string
  expectedRevision: number
  action: C
}

export interface CommandReceipt<C, Seat extends string> {
  side: Seat
  id: string
  action: C
  revision: number
}

export interface MatchRecord<S, C, Seat extends string> {
  state: S
  revision: number
  receipts: readonly CommandReceipt<C, Seat>[]
}

/**
 * Pure server-side command acceptance. Persist the whole returned record atomically
 * before acknowledging. Resolve the authenticated seat before calling.
 */
export function acceptCommand<S, C, Seat extends string>(
  record: Readonly<MatchRecord<S, C, Seat>>,
  side: Seat,
  command: Readonly<Command<C>>,
  apply: (state: S, side: Seat, action: C) => S,
): { record: MatchRecord<S, C, Seat>; acknowledgedRevision: number; duplicate: boolean } {
  const previous = record.receipts.find((receipt) => receipt.side === side && receipt.id === command.id)
  if (previous) return { record, acknowledgedRevision: previous.revision, duplicate: true }
  if (command.expectedRevision !== record.revision) throw new Error('Stale match revision')

  const state = apply(record.state, side, command.action)
  const revision = record.revision + 1
  const receipts = [...record.receipts, { side, id: command.id, action: command.action, revision }]
  return { record: { state, revision, receipts }, acknowledgedRevision: revision, duplicate: false }
}
