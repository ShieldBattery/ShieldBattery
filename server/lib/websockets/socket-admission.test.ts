import { NydusServer } from 'nydus'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ClientChallenge } from '../../../common/users/client-proof'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { UserErrorCode } from '../../../common/users/user-network'
import { SiteConnectionEvent, siteConnectionPath } from '../../../common/websockets'
import { SessionReleaseCatalog, SessionReleaseKey } from '../netcode-v2/session-release-catalog'
import { FakeClock, StopCriteria } from '../time/testing/fake-clock'
import { ClientAttestation } from '../users/client-attestation'
import { TestClientKey } from '../users/testing/client-proofs'
import { RequestSessionLookup } from './session-lookup'
import { SocketAdmission } from './socket-admission'
import { ClientSocketsManager, UserSocketsManager } from './socket-groups'
import { createFakeNydusServer, InspectableNydusClient, NydusConnector } from './testing/websockets'

const user = { id: makeSbUserId(1), name: 'one' } as SbUser
const verificationFailure = expect.objectContaining({
  status: 403,
  payload: expect.objectContaining({ code: UserErrorCode.ClientVerificationFailed }),
})
const key = new TestClientKey()

let keys: SessionReleaseKey[]
let nydus: NydusServer
let sessionLookup: RequestSessionLookup
let connector: NydusConnector
let clock: FakeClock
let admission: SocketAdmission
let clientSockets: ClientSocketsManager
let userSockets: UserSocketsManager

function connect(clientId = 'client') {
  const client = connector.connectClient(user, clientId)
  vi.spyOn(client, 'close').mockImplementation(() => {
    client.emit('close', 'SERVER_CLOSE')
  })
  return client
}

function connectionEvents(client: InspectableNydusClient): SiteConnectionEvent[] {
  return vi
    .mocked(client.publish)
    .mock.calls.filter(([path]) => path === siteConnectionPath(client.id))
    .map(([, event]) => event)
}

function challengeFor(client: InspectableNydusClient): ClientChallenge | undefined {
  const event = connectionEvents(client).find(e => e.type === 'challenge')
  return event?.type === 'challenge' ? event.challenge : undefined
}

/** Whether the client was told it's admitted before it got any of its groups' updates. */
function toldAdmittedFirst(client: InspectableNydusClient) {
  const paths = vi.mocked(client.publish).mock.calls.map(([path]) => path)
  const admitted = vi
    .mocked(client.publish)
    .mock.calls.findIndex(
      ([path, event]) => path === siteConnectionPath(client.id) && event.type === 'admitted',
    )
  const firstGroupUpdate = paths.findIndex(path => path !== siteConnectionPath(client.id))
  return admitted !== -1 && firstGroupUpdate > admitted
}

const refused = { type: 'refused', reason: 'clientVerification' }

function sessionIdOf(client: InspectableNydusClient) {
  return sessionLookup.fromSocket(client)!.sessionId
}

function answer(client: InspectableNydusClient, withProof = true) {
  const challenge = challengeFor(client)!
  admission.attest(user.id, sessionIdOf(client), {
    attemptId: challenge.attemptId,
    proof: withProof ? key.sign(challenge.nonce, challenge.requestHash) : undefined,
  })
}

function isAdmitted() {
  return !!clientSockets.getById(user.id, 'client') && !!userSockets.getById(user.id)
}

beforeEach(() => {
  vi.stubEnv('SB_JWT_SECRET', 'socket-admission-test-secret')
  vi.stubEnv('SB_REQUIRE_CLIENT_ATTESTATION', undefined)
  keys = [key.releaseKey]
  nydus = createFakeNydusServer()
  sessionLookup = new RequestSessionLookup()
  connector = new NydusConnector(nydus, sessionLookup)
  clock = new FakeClock()
  clock.autoRunTimeouts = false
  admission = new SocketAdmission(
    nydus,
    sessionLookup,
    new ClientAttestation({ getClientKeys: () => keys } as unknown as SessionReleaseCatalog),
    clock,
  )
  clientSockets = new ClientSocketsManager(nydus, sessionLookup, admission)
  userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {}, admission)
})

afterEach(() => vi.unstubAllEnvs())

test('without client keys, app sockets are admitted without a challenge', () => {
  keys = []
  const client = connect()
  expect(isAdmitted()).toBe(true)
  expect(connectionEvents(client)).toEqual([{ type: 'admitted' }])
  expect(toldAdmittedFirst(client)).toBe(true)
})

describe('observing', () => {
  test('app sockets are admitted immediately but still challenged', () => {
    const client = connect()
    expect(isAdmitted()).toBe(true)
    expect(connectionEvents(client)).toEqual([
      { type: 'challenge', challenge: expect.any(Object) },
      { type: 'admitted' },
    ])
    expect(toldAdmittedFirst(client)).toBe(true)
    expect(() => answer(client)).not.toThrow()
  })

  test('missing proofs are recorded without refusing anything', () => {
    const client = connect()
    expect(() => answer(client, false)).not.toThrow()
    expect(client.close).not.toHaveBeenCalled()
    expect(isAdmitted()).toBe(true)
  })
})

describe('requiring proofs', () => {
  beforeEach(() => {
    vi.stubEnv('SB_REQUIRE_CLIENT_ATTESTATION', 'true')
  })

  test('app sockets join their groups only after a valid proof', () => {
    const onNewClient = vi.fn()
    clientSockets.on('newClient', onNewClient)
    const client = connect()
    expect(isAdmitted()).toBe(false)
    expect(onNewClient).not.toHaveBeenCalled()

    answer(client)
    expect(isAdmitted()).toBe(true)
    expect(onNewClient).toHaveBeenCalledOnce()
    expect(connectionEvents(client)).toEqual([
      { type: 'challenge', challenge: expect.any(Object) },
      { type: 'admitted' },
    ])
    expect(toldAdmittedFirst(client)).toBe(true)
  })

  test('web sockets and authorized development clients are never challenged', () => {
    const web = connector.connectClient(user, 'web', 'web')
    const development = connector.connectClient(user, 'development', 'electron', true)
    expect(clientSockets.getById(user.id, 'web')).toBeDefined()
    expect(clientSockets.getById(user.id, 'development')).toBeDefined()
    expect(connectionEvents(web)).toEqual([{ type: 'admitted' }])
    expect(connectionEvents(development)).toEqual([{ type: 'admitted' }])
  })

  test('a missing proof closes the socket', () => {
    const client = connect()
    expect(() => answer(client, false)).toThrow(verificationFailure)
    expect(client.close).toHaveBeenCalled()
    expect(connectionEvents(client).at(-1)).toEqual(refused)
    expect(isAdmitted()).toBe(false)
  })

  test('an invalid proof closes the socket', () => {
    const client = connect()
    const challenge = challengeFor(client)!
    const proof = new TestClientKey().sign(challenge.nonce, challenge.requestHash)
    expect(() =>
      admission.attest(user.id, sessionIdOf(client), { attemptId: challenge.attemptId, proof }),
    ).toThrow(verificationFailure)
    expect(client.close).toHaveBeenCalled()
    expect(connectionEvents(client).at(-1)).toEqual(refused)
  })

  test('outdated builds are told to update', () => {
    const client = connect()
    const challenge = challengeFor(client)!
    const proof = new TestClientKey(99).sign(challenge.nonce, challenge.requestHash)
    expect(() =>
      admission.attest(user.id, sessionIdOf(client), { attemptId: challenge.attemptId, proof }),
    ).toThrow(
      expect.objectContaining({
        status: 403,
        payload: expect.objectContaining({ code: UserErrorCode.ClientUpdateRequired }),
      }),
    )
    expect(client.close).toHaveBeenCalled()
    expect(connectionEvents(client).at(-1)).toEqual({ type: 'refused', reason: 'clientUpdate' })
  })

  test("a proof can't answer a different socket's challenge", () => {
    const first = connect()
    const second = connect('other')
    const firstChallenge = challengeFor(first)!
    const secondChallenge = challengeFor(second)!
    expect(() =>
      admission.attest(user.id, sessionIdOf(second), {
        attemptId: secondChallenge.attemptId,
        proof: key.sign(firstChallenge.nonce, firstChallenge.requestHash),
      }),
    ).toThrow(verificationFailure)
  })

  test('only the session the challenge was sent to can answer it', () => {
    const client = connect()
    const challenge = challengeFor(client)!
    const proof = key.sign(challenge.nonce, challenge.requestHash)
    expect(() =>
      admission.attest(user.id, 'some-other-session', { attemptId: challenge.attemptId, proof }),
    ).toThrow(expect.objectContaining({ status: 400 }))
    expect(() =>
      admission.attest(makeSbUserId(2), sessionIdOf(client), {
        attemptId: challenge.attemptId,
        proof,
      }),
    ).toThrow(expect.objectContaining({ status: 400 }))

    // Neither consumed the challenge
    answer(client)
    expect(isAdmitted()).toBe(true)
  })

  test('each challenge can only be answered once', () => {
    const client = connect()
    answer(client)
    expect(() => answer(client)).toThrow(expect.objectContaining({ status: 400 }))
  })

  test('unanswered challenges expire and close the socket, without refusing the client', async () => {
    const client = connect()
    await clock.runTimeoutsUntil({ criteria: StopCriteria.EmptyQueue })
    expect(client.close).toHaveBeenCalled()
    expect(connectionEvents(client).map(e => e.type)).toEqual(['challenge'])
    expect(() => answer(client)).toThrow(expect.objectContaining({ status: 400 }))
    expect(isAdmitted()).toBe(false)
  })

  test('sockets that disconnect before answering are forgotten', () => {
    const client = connect()
    client.disconnect()
    expect(() => answer(client)).toThrow(expect.objectContaining({ status: 400 }))
    expect(isAdmitted()).toBe(false)
  })
})
