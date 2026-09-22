import { timingSafeEqual } from 'node:crypto'
import { createServer, Server, Socket } from 'node:net'

const MAX_LINE = 1024 * 1024
const MAX_PENDING = 8 * MAX_LINE

/** An ordered, session-scoped turn bus. It never binds a TCP/UDP port. */
export class LocalGameHub {
  private server?: Server
  private sockets = new Set<Socket>()
  private peers = new Map<number, Socket>()
  private pending: Array<{ slot: number; line: string }> = []
  private pendingBytes = 0
  private ready = false
  private closed = false

  constructor(
    readonly endpoint: string,
    private secret: string,
    private playerCount: number,
    private onFailure: (error: Error) => void,
  ) {}

  async listen(): Promise<void> {
    this.server = createServer(socket => this.connect(socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.endpoint, () => {
        this.server!.removeListener('error', reject)
        resolve()
      })
    })
    this.server.on('error', error => this.fail(error))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.peers.clear()
    this.pending = []
    this.server?.close()
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.close()
    this.onFailure(error)
  }

  private connect(socket: Socket): void {
    if (this.closed) {
      socket.destroy()
      return
    }
    this.sockets.add(socket)
    let slot: number | undefined
    let buffer = Buffer.alloc(0)
    const helloTimeout = setTimeout(() => socket.destroy(), 5000)
    socket.on('error', error => {
      if (slot !== undefined) this.fail(error)
    })
    socket.on('close', () => {
      clearTimeout(helloTimeout)
      this.sockets.delete(socket)
      if (slot !== undefined) this.fail(new Error(`Local game client ${slot} disconnected`))
    })
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
          const end = buffer.indexOf(10)
          if (end === -1) {
            if (buffer.length > MAX_LINE) throw new Error('Local game frame is too large')
            break
          }
          if (end > MAX_LINE) throw new Error('Local game frame is too large')
          const message = JSON.parse(buffer.subarray(0, end).toString('utf8'))
          buffer = buffer.subarray(end + 1)
          if (slot === undefined) {
            const secret = Buffer.from(typeof message.secret === 'string' ? message.secret : '')
            const expected = Buffer.from(this.secret)
            if (
              message.type !== 'hello' ||
              secret.length !== expected.length ||
              !timingSafeEqual(secret, expected) ||
              !Number.isInteger(message.slot) ||
              message.slot < 0 ||
              message.slot >= this.playerCount ||
              this.peers.has(message.slot)
            ) {
              socket.destroy()
              return
            }
            slot = message.slot as number
            clearTimeout(helloTimeout)
            this.peers.set(slot, socket)
            if (this.peers.size === this.playerCount) {
              this.ready = true
              for (const peer of this.peers.values()) {
                this.write(peer, JSON.stringify({ type: 'ready', initialBufferTurns: 1 }) + '\n')
              }
              for (const entry of this.pending) this.broadcast(entry.slot, entry.line)
              this.pending = []
              this.pendingBytes = 0
            }
          } else {
            if (message.type === 'started' || message.type === 'leave') continue
            if (!['turn', 'lobby', 'skin', 'chat'].includes(message.type)) {
              throw new Error('Invalid local game message type')
            }
            const line = JSON.stringify({ ...message, slot }) + '\n'
            if (this.ready) this.broadcast(slot, line)
            else {
              this.pendingBytes += Buffer.byteLength(line)
              if (this.pendingBytes > MAX_PENDING)
                throw new Error('Local game startup queue overflow')
              this.pending.push({ slot, line })
            }
          }
        }
      } catch (error) {
        if (slot === undefined) socket.destroy()
        else this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private broadcast(sender: number, line: string): void {
    for (const [slot, socket] of this.peers) {
      if (slot !== sender) this.write(socket, line)
    }
  }

  private write(socket: Socket, line: string): void {
    if (socket.writableLength + Buffer.byteLength(line) > MAX_PENDING) {
      throw new Error('Local game client is not consuming messages')
    }
    socket.write(line)
  }
}
