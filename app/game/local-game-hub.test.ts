import { randomUUID } from 'node:crypto'
import { connect, Socket } from 'node:net'
import { afterEach, expect, test, vi } from 'vitest'
import { LocalGameHub } from './local-game-hub'

const resources: Array<() => void> = []
afterEach(() => {
  for (const dispose of resources.splice(0).reverse()) dispose()
})

async function setup() {
  const endpoint = `\\\\.\\pipe\\sb-local-test-${randomUUID()}`
  const secret = 'a'.repeat(64)
  const failure = vi.fn()
  const hub = new LocalGameHub(endpoint, secret, 2, failure)
  await hub.listen()
  resources.push(() => hub.close())
  const client = async (slot: number) => {
    const socket = connect(endpoint)
    resources.push(() => socket.destroy())
    const messages: any[] = []
    let pending = ''
    socket.on('data', data => {
      pending += data.toString('utf8')
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline < 0) break
        messages.push(JSON.parse(pending.slice(0, newline)))
        pending = pending.slice(newline + 1)
      }
    })
    socket.on('error', () => {})
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    const hello = JSON.stringify({ type: 'hello', slot, secret }) + '\n'
    // Handshakes may span several reads just like game frames.
    socket.write(hello.slice(0, 20))
    socket.write(hello.slice(20))
    return { socket, messages }
  }
  return { client, failure }
}

function send(socket: Socket, message: object) {
  socket.write(JSON.stringify(message) + '\n')
}

test('queues early lobby frames, binds the sender, and forwards turns without local echoes', async () => {
  const { client, failure } = await setup()
  const first = await client(0)
  send(first.socket, { type: 'lobby', slot: 7, payload: 'AQID' })
  const second = await client(1)
  await vi.waitFor(() => expect(second.messages).toHaveLength(2))
  expect(second.messages).toEqual([
    { type: 'ready', initialBufferTurns: 1 },
    { type: 'lobby', slot: 0, payload: 'AQID' },
  ])
  const turn = {
    type: 'turn',
    seq: '9007199254740993',
    commands: 'AA==',
    gameFrame: 0,
    syncGeneration: null,
  }
  send(second.socket, turn)
  await vi.waitFor(() => expect(first.messages).toHaveLength(2))
  expect(first.messages[1]).toEqual({ ...turn, slot: 1 })
  expect(second.messages).toHaveLength(2)
  expect(failure).not.toHaveBeenCalled()
})

test('forwards an authenticated leave directive without echoing it to the departed client', async () => {
  const { client, failure } = await setup()
  const first = await client(0)
  const second = await client(1)
  await vi.waitFor(() => expect(second.messages).toHaveLength(1))

  send(first.socket, {
    type: 'turn',
    seq: '0',
    commands: 'AA==',
    gameFrame: 12,
    syncGeneration: null,
  })
  await vi.waitFor(() => expect(second.messages).toHaveLength(2))
  send(first.socket, {
    type: 'leave',
    slot: 1,
    finalTurnCount: '1',
    applyAtFrame: 13,
  })

  await vi.waitFor(() => expect(second.messages).toHaveLength(3))
  expect(second.messages[2]).toEqual({
    type: 'leave',
    slot: 0,
    reason: 3,
    applyAtFrame: 13,
    leaveSeq: '1',
    finalTurnCount: '1',
    finalized: false,
  })
  expect(first.messages).toHaveLength(1)
  first.socket.destroy()
  await vi.waitFor(() => expect(first.socket.destroyed).toBe(true))
  expect(failure).not.toHaveBeenCalled()
})

test('rejects a leave directive whose turn count was not forwarded', async () => {
  const { client, failure } = await setup()
  const first = await client(0)
  const second = await client(1)
  await vi.waitFor(() => expect(second.messages).toHaveLength(1))

  send(first.socket, { type: 'leave', finalTurnCount: '1', applyAtFrame: 0 })

  await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce())
  expect(failure.mock.calls[0][0].message).toContain('final turn count')
})

test('a duplicate slot cannot replace an established client', async () => {
  const { client, failure } = await setup()
  const first = await client(0)
  const duplicate = await client(0)
  await vi.waitFor(() => expect(duplicate.socket.destroyed).toBe(true))
  const second = await client(1)
  await vi.waitFor(() => expect(second.messages).toHaveLength(1))
  expect(first.socket.destroyed).toBe(false)
  expect(failure).not.toHaveBeenCalled()
})

test('a connected client crash closes the whole bus and reports one failure', async () => {
  const { client, failure } = await setup()
  const first = await client(0)
  const second = await client(1)
  await vi.waitFor(() => expect(second.messages).toHaveLength(1))
  first.socket.destroy()
  await vi.waitFor(() => expect(second.socket.destroyed).toBe(true))
  expect(failure).toHaveBeenCalledOnce()
})

test('rejects oversized fragmented input without letting it grow indefinitely', async () => {
  const { client, failure } = await setup()
  const first = await client(0)
  const second = await client(1)
  await vi.waitFor(() => expect(second.messages).toHaveLength(1))
  first.socket.write(Buffer.alloc(1024 * 1024 + 1, 65))
  await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce())
  expect(failure.mock.calls[0][0].message).toContain('too large')
})
