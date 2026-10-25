import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { NydusClient, NydusServer } from 'nydus'
import { singleton } from 'tsyringe'
import { ClientAttestationRequest } from '../../../common/users/client-proof'
import { SbUserId } from '../../../common/users/sb-user-id'
import {
  SiteConnectionEvent,
  siteConnectionPath,
  SiteConnectionRefusal,
} from '../../../common/websockets'
import log from '../logging/logger'
import { Clock, TimeoutId } from '../time/clock'
import {
  ClientAttestation,
  clientAttestationFailed,
  ClientAttestationMode,
} from '../users/client-attestation'
import { invalidProof, requestContext } from '../users/client-proof'
import { RequestSessionLookup, SessionInfo } from './session-lookup'

export const ATTESTATION_TIMEOUT_MS = 60 * 1000

interface PendingSocket {
  socket: NydusClient
  session: SessionInfo
  mode: ClientAttestationMode
  nonce: Buffer
  requestHash: Buffer
  timer: TimeoutId
  onClose: () => void
}

type SocketAdmissionEvents = {
  admitted: [socket: NydusClient]
}

/** Decides when a newly connected socket joins its user and client groups. */
@singleton()
export class SocketAdmission extends EventEmitter<SocketAdmissionEvents> {
  private pending = new Map<string, PendingSocket>()

  constructor(
    private nydus: NydusServer,
    private sessionLookup: RequestSessionLookup,
    private attestation: ClientAttestation,
    private clock: Clock,
  ) {
    super()
    this.nydus.on('connection', socket => this.handleConnection(socket))
  }

  private handleConnection(socket: NydusClient) {
    const session = this.sessionLookup.fromSocket(socket)
    if (!session) {
      // Reported (and dropped) by the socket groups
      this.emit('admitted', socket)
      return
    }

    const path = siteConnectionPath(socket.id)
    const mode =
      session.clientType === 'electron' && !session.developmentClient
        ? this.attestation.mode()
        : 'off'
    if (mode === 'off') {
      this.nydus.subscribeClient<SiteConnectionEvent>(socket, path, { type: 'admitted' })
      this.emit('admitted', socket)
      return
    }

    const attemptId = randomUUID()
    const nonce = randomBytes(32)
    const requestHash = requestContext('sb-socket-request-key-v1', nonce, [
      session.userId,
      session.sessionId,
      session.clientId,
    ])
    const onClose = () => {
      if (this.take(attemptId)) {
        this.attestation.record('socket', mode, 'abandoned')
      }
    }
    socket.once('close', onClose)
    this.pending.set(attemptId, {
      socket,
      session,
      mode,
      nonce,
      requestHash,
      timer: this.clock.setTimeout(() => this.expire(attemptId), ATTESTATION_TIMEOUT_MS),
      onClose,
    })

    this.nydus.subscribeClient<SiteConnectionEvent>(socket, path, {
      type: 'challenge',
      challenge: {
        attemptId,
        nonce: nonce.toString('base64'),
        requestHash: requestHash.toString('base64'),
      },
    })
    if (mode !== 'required') {
      this.admit(socket)
    }
  }

  private admit(socket: NydusClient) {
    this.nydus.publish<SiteConnectionEvent>(siteConnectionPath(socket.id), { type: 'admitted' })
    this.emit('admitted', socket)
  }

  private refuse(socket: NydusClient, reason: SiteConnectionRefusal) {
    this.nydus.publish<SiteConnectionEvent>(siteConnectionPath(socket.id), {
      type: 'refused',
      reason,
    })
    socket.close()
  }

  private take(attemptId: string): PendingSocket | undefined {
    const entry = this.pending.get(attemptId)
    if (!entry) return undefined

    this.pending.delete(attemptId)
    this.clock.clearTimeout(entry.timer)
    entry.socket.removeListener('close', entry.onClose)
    return entry
  }

  private expire(attemptId: string) {
    const entry = this.take(attemptId)
    if (!entry) return

    this.attestation.record('socket', entry.mode, 'expired')
    if (entry.mode === 'required') {
      log.info(
        { userId: entry.session.userId, clientId: entry.session.clientId },
        'closing unadmitted app socket',
      )
      // Not a refusal, the client can reconnect and try again
      entry.socket.close()
    }
  }

  attest(userId: SbUserId, sessionId: string, { attemptId, proof }: ClientAttestationRequest) {
    const existing = this.pending.get(attemptId)
    if (
      !existing ||
      existing.session.userId !== userId ||
      existing.session.sessionId !== sessionId
    ) {
      invalidProof()
    }

    const entry = this.take(attemptId)!
    const result = this.attestation.check(
      'socket',
      entry.mode,
      entry.nonce,
      entry.requestHash,
      proof,
    )
    if (entry.mode !== 'required') return

    if (result.identifiers) {
      this.admit(entry.socket)
    } else {
      this.refuse(
        entry.socket,
        result.outcome === 'outdated' ? 'clientUpdate' : 'clientVerification',
      )
      clientAttestationFailed(result.outcome)
    }
  }
}
