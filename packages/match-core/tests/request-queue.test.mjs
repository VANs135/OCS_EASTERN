import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { acceptCommand } from '../src/command-log.ts'
import { createRequestQueue } from '../src/request-queue.ts'

test('queued commands check the revision and seat after the previous commit', async () => {
  let record = { state: { value: 0, actor: 'one' }, revision: 0, receipts: [] }
  const started = Promise.withResolvers()
  const persisted = Promise.withResolvers()
  const queue = createRequestQueue(async ({ seat, command }) => {
    const accepted = acceptCommand(record, seat, command, (state, actor, action) => {
      if (state.actor !== actor) throw new Error('Wrong seat')
      return { value: state.value + action.amount, actor: actor === 'one' ? 'two' : 'one' }
    })
    if (command.id === 'first' && !accepted.duplicate) {
      started.resolve()
      await persisted.promise
    }
    record = accepted.record
    return accepted
  }, () => {})
  const first = { seat: 'one', command: { id: 'first', expectedRevision: 0, action: { amount: 1 } } }
  const pending = queue.dispatch(first)
  const stale = assert.rejects(queue.dispatch({ seat: 'one', command: { ...first.command, id: 'stale' } }), /Stale/)
  await started.promise
  assert.equal(record.revision, 0)
  persisted.resolve()
  assert.equal((await pending).acknowledgedRevision, 1)
  await stale
  assert.equal(record.state.value, 1)
  assert.equal((await queue.dispatch(first)).duplicate, true)
  await assert.rejects(queue.dispatch({ seat: 'one', command: { ...first.command, id: 'wrong', expectedRevision: 1 } }), /Wrong seat/)
  const second = { id: 'second', expectedRevision: 1, action: { amount: 5 } }
  await queue.dispatch({ seat: 'two', command: second })
  assert.deepEqual(record.state, { value: 6, actor: 'one' })
  assert.equal(record.receipts.length, 2)
  await queue.close()
})

test('closing drains accepted requests, rejects new work and releases only once', async () => {
  const gate = Promise.withResolvers()
  const order = []
  const queue = createRequestQueue(async (request) => {
    if (request === 1) await gate.promise
    order.push(request)
  }, () => { order.push('release') })
  const first = queue.dispatch(1)
  const second = queue.dispatch(2)
  const closing = queue.close()
  assert.equal(queue.close(), closing)
  await assert.rejects(queue.dispatch(3), /closed/)
  assert.deepEqual(order, [])
  gate.resolve()
  await Promise.all([first, second, closing])
  assert.deepEqual(order, [1, 2, 'release'])
})
