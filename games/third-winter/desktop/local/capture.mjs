import { canDisplaceScorpionTransport } from '../../src/match/scorpion-transport-capture.ts'

export const offMapAir = 'air-box'

export function localCapture(state, draft, { map, catalog }) {
  const capture = state.capture
  if (!capture) return null
  const saved = draft?.answers ?? {}
  const name = (id) => {
    const counter = state.units[id] ?? state.pieces.find((piece) => piece.id === id)
    return catalog.definitions.get(counter?.definition)?.source.name ?? id
  }
  const displacement = (kind, id, destinations) => {
    const destination = destinations.length === 1 ? destinations[0] : saved[id]?.destination
    const label = kind === 'extender' ? `延补队 · ${name(id)}` : name(id)
    return { kind, id, label, destinations, destination, complete: destinations.includes(destination) }
  }
  const aircraft = capture.aircraft.map(({ id, destinations }) => displacement('aircraft', id,
    destinations.map((base) => base.kind === 'hex' ? base.hex : offMapAir)))
  const extenders = (capture.extenders ?? []).map(({ id, destinations }) => displacement('extender', id, destinations))
  const transports = []
  const groups = capture.transports.map((group) => {
    const { kind, members, die, points, tokens } = group
    const destinations = [...map.hexes.keys()].filter((at) => canDisplaceScorpionTransport(map, kind, capture.hex, at))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    const totalPoints = members.reduce((sum, member) => sum + member.points, 0)
    const totalTokens = members.reduce((sum, member) => sum + member.tokens, 0)
    const rows = members.map((member) => {
      const row = displacement('transport', member.id, destinations)
      const pointValues = allocationOptions(points, totalPoints, member.points)
      const tokenValues = allocationOptions(tokens, totalTokens, member.tokens)
      const takenPoints = pointValues.length === 1 ? pointValues[0] : saved[member.id]?.takenPoints
      const takenTokens = tokenValues.length === 1 ? tokenValues[0] : saved[member.id]?.takenTokens
      const allocated = takenPoints !== undefined && takenTokens !== undefined
      const needsDestination = allocated && (takenPoints < member.points || takenTokens < member.tokens)
      return { ...row, points: member.points, tokens: member.tokens, takenPoints, takenTokens, pointValues, tokenValues,
        destinations: needsDestination ? destinations : [], destination: needsDestination ? row.destination : undefined,
        complete: allocated && (!needsDestination || row.complete) }
    })
    transports.push(...rows)
    const assignedPoints = rows.reduce((sum, row) => sum + (row.takenPoints ?? 0), 0)
    const assignedTokens = rows.reduce((sum, row) => sum + (row.takenTokens ?? 0), 0)
    return { kind, die, points, tokens, assignedPoints, assignedTokens }
  })
  const rows = [...transports, ...aircraft, ...extenders]
  const focus = rows.find(({ id }) => id === draft?.focus) ?? rows.find(({ complete }) => !complete) ?? rows[0]
  const ready = rows.every(({ complete }) => complete) &&
    groups.every((group) => group.assignedPoints === group.points && group.assignedTokens === group.tokens)
  return { hex: capture.hex, rows, focus, groups, ready }
}

function allocationOptions(totalTaken, totalAvailable, available) {
  const first = Math.max(0, totalTaken - (totalAvailable - available))
  const last = Math.min(available, totalTaken)
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

export function editLocalCapture(draft, capture, { id, field, value }) {
  const row = capture.rows.find((entry) => entry.id === id)
  if (!row) throw new Error('请选择待处理的算子。')
  const options = { takenPoints: row.pointValues, takenTokens: row.tokenValues, destination: row.destinations }
  if (!Object.hasOwn(options, field) || !options[field]?.includes(value)) {
    throw new Error('请选择该算子的有效数量或位移落点。')
  }
  const answers = draft?.answers ?? {}
  return { focus: id, answers: { ...answers, [id]: { ...answers[id], [field]: value } } }
}

export function localCaptureOrder(capture) {
  if (!capture.ready) throw new Error('请分配完夺取点数与货物，并选定全部位移落点。')
  return { type: 'settle-capture',
    aircraft: capture.rows.filter(({ kind }) => kind === 'aircraft').map(({ id, destination }) => ({
      id, destination: destination === offMapAir ? { kind: 'off-map-air' } : { kind: 'hex', hex: destination },
    })),
    extenders: capture.rows.filter(({ kind }) => kind === 'extender').map(({ id, destination }) => ({ id, destination })),
    transports: capture.rows.filter(({ kind }) => kind === 'transport').map(({ id, takenPoints, takenTokens, destination }) =>
      ({ id, takenPoints, takenTokens, ...(destination ? { displacedTo: destination } : {}) })),
  }
}
