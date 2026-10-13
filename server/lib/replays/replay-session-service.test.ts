import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameSource } from '../../../common/games/configuration'
import { GameRecord } from '../../../common/games/games'
import {
  ReplaySessionErrorCode,
  ReplaySessionEvent,
  ReplaySessionInvitesEvent,
  ReplaySessionJson,
  SbReplaySessionId,
} from '../../../common/replay-sessions'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { getSignedUrl } from '../files'
import { getGameRecord } from '../games/game-models'
import { processMessageContents } from '../messaging/process-chat-message'
import { FakeClock } from '../time/testing/fake-clock'
import { RestrictionService } from '../users/restriction-service'
import { RequestSessionLookup } from '../websockets/session-lookup'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  FakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getBestReplayForGame, ReplayFile } from './replay-models'
import {
  getReplaySessionInvitesPath,
  getReplaySessionPath,
  ReplaySessionService,
} from './replay-session-service'
import { ReplaySessionUpload } from './replay-session-source-models'
import { ReplaySessionSourceService } from './replay-session-source-service'

vi.mock('../files', () => ({ getSignedUrl: vi.fn() }))
vi.mock('../games/game-models', () => ({ getGameRecord: vi.fn() }))
vi.mock('./replay-models', () => ({ getBestReplayForGame: vi.fn() }))
vi.mock('../messaging/process-chat-message', () => ({ processMessageContents: vi.fn() }))

const HOST = { id: makeSbUserId(1), name: 'Host' } as SbUser
const VIEWER = { id: makeSbUserId(2), name: 'Viewer' } as SbUser
const OTHER = { id: makeSbUserId(3), name: 'Other' } as SbUser

const REPLAY_HASH = 'ab'.repeat(32)
const OTHER_HASH = 'cd'.repeat(32)

const HEADER = { mapName: 'Fighting Spirit', gameType: 2, frames: 12000 } as any

function lobbyGame({
  listed,
  participants,
}: {
  listed: boolean
  participants: SbUserId[]
}): GameRecord {
  return {
    id: 'game-id',
    config: {
      gameSource: GameSource.Lobby,
      gameSourceExtra: { visibility: listed ? 'listed' : 'unlisted' },
      teams: [participants.map(id => ({ id, race: 'p', isComputer: false }))],
      observers: [],
    },
  } as unknown as GameRecord
}

function replayFile(): ReplayFile {
  return {
    id: 'replay-file-id',
    hash: Buffer.from(REPLAY_HASH, 'hex'),
    size: 1234,
    header: HEADER,
  } as ReplayFile
}

function upload(): ReplaySessionUpload {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    ownerUserId: HOST.id,
    hash: Buffer.from(REPLAY_HASH, 'hex'),
    size: 4321,
    header: HEADER,
  } as ReplaySessionUpload
}

interface Sockets {
  client: ClientSocketsGroup
  socket: InspectableNydusClient
}

describe('replays/replay-session-service', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let service: ReplaySessionService
  let sourceService: {
    retainSourceForOwner: ReturnType<typeof vi.fn>
    retainSources: ReturnType<typeof vi.fn>
  }
  let isChatRestricted: boolean
  let connect: (user: SbUser, clientId?: string) => Sockets
  let host: Sockets
  let viewer: Sockets

  beforeEach(() => {
    vi.clearAllMocks()
    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const clientSockets = new ClientSocketsManager(nydus, sessionLookup)
    const userSockets = new UserSocketsManager(nydus, sessionLookup, async () => {})

    const clock = new FakeClock()
    clock.setCurrentTime(Number(new Date('2026-10-13T12:00:00.000Z')))
    isChatRestricted = false
    sourceService = {
      retainSourceForOwner: vi.fn(async (sourceId: string, ownerId: SbUserId) =>
        sourceId === upload().id && ownerId === HOST.id ? upload() : undefined,
      ),
      retainSources: vi.fn(async (ids: string[]) => new Set(ids)),
    }

    service = new ReplaySessionService(
      new TypedPublisher(nydus),
      sourceService as unknown as ReplaySessionSourceService,
      { isRestricted: async () => isChatRestricted } as unknown as RestrictionService,
      userSockets,
      clock,
    )

    asMockedFunction(getGameRecord).mockResolvedValue(
      lobbyGame({ listed: true, participants: [OTHER.id] }),
    )
    asMockedFunction(getBestReplayForGame).mockResolvedValue(replayFile())
    asMockedFunction(getSignedUrl).mockImplementation(async path => `signed:${path}`)

    const connector = new NydusConnector(nydus, sessionLookup)
    connect = (user, clientId = `${user.name}-client`) => {
      const socket = connector.connectClient(user, clientId)
      return { client: clientSockets.getById(user.id, clientId)!, socket }
    }
    host = connect(HOST)
    viewer = connect(VIEWER)

    clearTestLogs(nydus)
  })

  function snapshots(sessionId: SbReplaySessionId): ReplaySessionJson[] {
    return fakeNydus.publish.mock.calls
      .filter(
        ([path, data]) => path === getReplaySessionPath(sessionId) && data?.type === 'snapshot',
      )
      .map(([, data]) => (data as Extract<ReplaySessionEvent, { type: 'snapshot' }>).session)
  }

  function latest(sessionId: SbReplaySessionId): ReplaySessionJson {
    return snapshots(sessionId).at(-1)!
  }

  function latestInvites(userId: SbUserId) {
    const calls = fakeNydus.publish.mock.calls.filter(
      ([path]) => path === getReplaySessionInvitesPath(userId),
    )
    return (calls.at(-1)?.[1] as ReplaySessionInvitesEvent | undefined)?.invites
  }

  async function createGameSession() {
    return await service.createSession({
      client: host.client,
      source: { kind: 'game', gameId: 'game-id' },
    })
  }

  async function sessionWithViewer() {
    const session = await createGameSession()
    await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })
    await service.joinSession({ client: viewer.client, sessionId: session.id })
    return session
  }

  describe('sources', () => {
    test('creates a gathering session for an accessible game replay', async () => {
      const session = await createGameSession()

      expect(session).toMatchObject({
        state: 'gathering',
        hostId: HOST.id,
        source: {
          kind: 'game',
          gameId: 'game-id',
          metadata: { mapName: 'Fighting Spirit', gameType: '2', durationFrames: 12000 },
        },
        members: [{ userId: HOST.id, loaded: false }],
        invitedUserIds: [],
        playback: { epoch: 0, frame: 0, paused: false, speed: 1 },
      })
      expect(latest(session.id)).toEqual(session)
    })

    test("refuses an unlisted game's replay to a host who wasn't in it", async () => {
      asMockedFunction(getGameRecord).mockResolvedValue(
        lobbyGame({ listed: false, participants: [OTHER.id] }),
      )

      await expect(createGameSession()).rejects.toMatchObject({
        code: ReplaySessionErrorCode.ReplayNotAccessible,
      })
    })

    test('refuses a game without a stored replay', async () => {
      asMockedFunction(getBestReplayForGame).mockResolvedValue(null)

      await expect(createGameSession()).rejects.toMatchObject({
        code: ReplaySessionErrorCode.SourceNotFound,
      })
    })

    test("retains the owner's upload and keeps its id out of the session", async () => {
      const session = await service.createSession({
        client: host.client,
        source: { kind: 'upload', sourceId: upload().id },
      })

      expect(sourceService.retainSourceForOwner).toHaveBeenCalledWith(upload().id, HOST.id)
      expect(session.source).toEqual({
        kind: 'upload',
        metadata: { mapName: 'Fighting Spirit', gameType: '2', durationFrames: 12000 },
      })
      expect(JSON.stringify(session)).not.toContain(upload().id)
    })

    test("refuses another user's (or an expired) upload", async () => {
      await expect(
        service.createSession({
          client: viewer.client,
          source: { kind: 'upload', sourceId: upload().id },
        }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.SourceNotFound })
    })

    test('refuses to put a user in two sessions', async () => {
      await createGameSession()

      await expect(createGameSession()).rejects.toMatchObject({
        code: ReplaySessionErrorCode.AlreadyInSession,
      })
    })
  })

  describe('invites and joining', () => {
    test("publishes an invite to the target's invite channel", async () => {
      const session = await createGameSession()

      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })

      expect(latest(session.id).invitedUserIds).toEqual([VIEWER.id])
      expect(latestInvites(VIEWER.id)).toEqual([
        { sessionId: session.id, hostId: HOST.id, source: session.source },
      ])
    })

    test('only the host can invite', async () => {
      const session = await sessionWithViewer()

      await expect(
        service.invite({ client: viewer.client, sessionId: session.id, targetId: OTHER.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.NotHost })
    })

    test("won't invite a user who can't access an unlisted game's replay", async () => {
      asMockedFunction(getGameRecord).mockResolvedValue(
        lobbyGame({ listed: false, participants: [HOST.id] }),
      )
      const session = await createGameSession()

      await expect(
        service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.TargetCannotAccessReplay })
    })

    test('invites to an uploaded replay need no game access', async () => {
      asMockedFunction(getGameRecord).mockResolvedValue(undefined)
      const session = await service.createSession({
        client: host.client,
        source: { kind: 'upload', sourceId: upload().id },
      })

      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })
      const joined = await service.joinSession({ client: viewer.client, sessionId: session.id })

      expect(joined.members.map(m => m.userId)).toEqual([HOST.id, VIEWER.id])
    })

    test('joining requires an invite', async () => {
      const session = await createGameSession()

      await expect(
        service.joinSession({ client: viewer.client, sessionId: session.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.NotInvited })
    })

    test('joining rechecks access to the replay', async () => {
      const session = await createGameSession()
      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })
      asMockedFunction(getGameRecord).mockResolvedValue(
        lobbyGame({ listed: false, participants: [HOST.id] }),
      )

      await expect(
        service.joinSession({ client: viewer.client, sessionId: session.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.ReplayNotAccessible })
    })

    test('joining consumes the invite and adds the member', async () => {
      const session = await sessionWithViewer()

      expect(latest(session.id)).toMatchObject({
        members: [
          { userId: HOST.id, loaded: false },
          { userId: VIEWER.id, loaded: false },
        ],
        invitedUserIds: [],
      })
      expect(latestInvites(VIEWER.id)).toEqual([])
      expect(viewer.socket.publish).toHaveBeenCalledWith(
        getReplaySessionPath(session.id),
        expect.objectContaining({ type: 'snapshot' }),
      )
    })

    test('declining withdraws the invite', async () => {
      const session = await createGameSession()
      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })

      service.declineInvite({ userId: VIEWER.id, sessionId: session.id })

      expect(latest(session.id).invitedUserIds).toEqual([])
      expect(latestInvites(VIEWER.id)).toEqual([])
    })
  })

  describe('loading barrier', () => {
    test('plays only once every member has loaded the same replay', async () => {
      const session = await sessionWithViewer()

      service.start({ client: host.client, sessionId: session.id })
      expect(latest(session.id).state).toBe('loading')

      service.reportLoaded({ client: host.client, sessionId: session.id, hash: REPLAY_HASH })
      expect(latest(session.id).state).toBe('loading')

      service.reportLoaded({
        client: viewer.client,
        sessionId: session.id,
        hash: REPLAY_HASH.toUpperCase(),
      })
      expect(latest(session.id)).toMatchObject({
        state: 'viewing',
        members: [
          { userId: HOST.id, loaded: true },
          { userId: VIEWER.id, loaded: true },
        ],
      })
    })

    test('rejects a load of different replay bytes', async () => {
      const session = await sessionWithViewer()
      service.start({ client: host.client, sessionId: session.id })

      expect(() =>
        service.reportLoaded({ client: viewer.client, sessionId: session.id, hash: OTHER_HASH }),
      ).toThrow(expect.objectContaining({ code: ReplaySessionErrorCode.HashMismatch }))
      expect(latest(session.id).members[1].loaded).toBe(false)
    })

    test('rejects loads before the host starts', async () => {
      const session = await sessionWithViewer()

      expect(() =>
        service.reportLoaded({ client: viewer.client, sessionId: session.id, hash: REPLAY_HASH }),
      ).toThrow(expect.objectContaining({ code: ReplaySessionErrorCode.NotLoading }))
    })

    test('only the host can start', async () => {
      const session = await sessionWithViewer()

      expect(() => service.start({ client: viewer.client, sessionId: session.id })).toThrow(
        expect.objectContaining({ code: ReplaySessionErrorCode.NotHost }),
      )
    })

    test('a viewer admitted while loading holds up playback until they load too', async () => {
      const session = await createGameSession()
      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })
      service.start({ client: host.client, sessionId: session.id })
      await service.joinSession({ client: viewer.client, sessionId: session.id })

      service.reportLoaded({ client: host.client, sessionId: session.id, hash: REPLAY_HASH })
      expect(latest(session.id).state).toBe('loading')

      service.reportLoaded({ client: viewer.client, sessionId: session.id, hash: REPLAY_HASH })
      expect(latest(session.id).state).toBe('viewing')
    })

    test('a member leaving while loading can release the barrier', async () => {
      const session = await sessionWithViewer()
      service.start({ client: host.client, sessionId: session.id })
      service.reportLoaded({ client: host.client, sessionId: session.id, hash: REPLAY_HASH })

      service.leaveSession({ client: viewer.client, sessionId: session.id })

      expect(latest(session.id).state).toBe('viewing')
    })

    test('beginning playback withdraws outstanding invites and closes admission', async () => {
      const session = await createGameSession()
      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })
      service.start({ client: host.client, sessionId: session.id })
      service.reportLoaded({ client: host.client, sessionId: session.id, hash: REPLAY_HASH })

      expect(latest(session.id).invitedUserIds).toEqual([])
      expect(latestInvites(VIEWER.id)).toEqual([])
      await expect(
        service.joinSession({ client: viewer.client, sessionId: session.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.NotInvited })
      await expect(
        service.invite({ client: host.client, sessionId: session.id, targetId: OTHER.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.AlreadyStarted })
    })
  })

  describe('leaving', () => {
    async function viewingSession() {
      const session = await sessionWithViewer()
      service.start({ client: host.client, sessionId: session.id })
      service.reportLoaded({ client: host.client, sessionId: session.id, hash: REPLAY_HASH })
      service.reportLoaded({ client: viewer.client, sessionId: session.id, hash: REPLAY_HASH })
      return session
    }

    test('the host leaving hands control on and pauses playback in a new epoch', async () => {
      const session = await viewingSession()

      service.leaveSession({ client: host.client, sessionId: session.id })

      expect(latest(session.id)).toMatchObject({
        state: 'viewing',
        hostId: VIEWER.id,
        members: [{ userId: VIEWER.id }],
        playback: { epoch: 1, paused: true },
      })
    })

    test('a client disconnecting removes its member', async () => {
      const session = await viewingSession()

      viewer.socket.disconnect()

      expect(latest(session.id).members.map(m => m.userId)).toEqual([HOST.id])
    })

    test('the last member leaving ends the session', async () => {
      const session = await createGameSession()

      service.leaveSession({ client: host.client, sessionId: session.id })

      expect(latest(session.id).state).toBe('ended')
      // The user is free to start another session
      await expect(createGameSession()).resolves.toMatchObject({ state: 'gathering' })
    })

    test('closing ends the session for every member and withdraws invites', async () => {
      const session = await sessionWithViewer()
      await service.invite({ client: host.client, sessionId: session.id, targetId: OTHER.id })

      service.closeSession({ client: host.client, sessionId: session.id })

      expect(latest(session.id).state).toBe('ended')
      expect(latestInvites(OTHER.id)).toEqual([])
      expect(() => service.leaveSession({ client: viewer.client, sessionId: session.id })).toThrow(
        expect.objectContaining({ code: ReplaySessionErrorCode.NotInSession }),
      )
    })

    test('revisions only ever increase', async () => {
      const session = await viewingSession()
      service.leaveSession({ client: host.client, sessionId: session.id })
      service.leaveSession({ client: viewer.client, sessionId: session.id })

      const revisions = snapshots(session.id).map(s => s.revision)
      expect(revisions).toEqual([...revisions].sort((a, b) => a - b))
      expect(new Set(revisions).size).toBe(revisions.length)
    })

    test("a stale client can't act on its user's session", async () => {
      const session = await createGameSession()
      const secondClient = connect(HOST, 'second-client')

      expect(() =>
        service.leaveSession({ client: secondClient.client, sessionId: session.id }),
      ).toThrow(expect.objectContaining({ code: ReplaySessionErrorCode.NotInSession }))
    })
  })

  describe('source downloads', () => {
    test('hands a member a short-lived URL for the uploaded replay', async () => {
      const session = await service.createSession({
        client: host.client,
        source: { kind: 'upload', sourceId: upload().id },
      })
      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })
      await service.joinSession({ client: viewer.client, sessionId: session.id })

      await expect(
        service.getSourceDownload({ userId: VIEWER.id, sessionId: session.id }),
      ).resolves.toEqual({
        url: `signed:replay-session-uploads/${upload().id}.rep`,
        hash: REPLAY_HASH,
        size: 4321,
      })
      expect(getSignedUrl).toHaveBeenCalledWith(expect.any(String), {
        expires: 300,
        contentType: 'application/octet-stream',
      })
    })

    test('refuses a download to anyone outside the session', async () => {
      const session = await createGameSession()
      await service.invite({ client: host.client, sessionId: session.id, targetId: VIEWER.id })

      await expect(
        service.getSourceDownload({ userId: VIEWER.id, sessionId: session.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.NotInSession })
    })

    test("hands a member the game's best replay after rechecking access", async () => {
      const session = await sessionWithViewer()

      await expect(
        service.getSourceDownload({ userId: VIEWER.id, sessionId: session.id }),
      ).resolves.toEqual({
        url: 'signed:replays/replay-file-id.rep',
        hash: REPLAY_HASH,
        size: 1234,
      })

      asMockedFunction(getGameRecord).mockResolvedValue(
        lobbyGame({ listed: false, participants: [HOST.id] }),
      )
      await expect(
        service.getSourceDownload({ userId: VIEWER.id, sessionId: session.id }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.ReplayNotAccessible })
    })
  })

  describe('chat', () => {
    test('publishes processed messages to the session', async () => {
      const session = await sessionWithViewer()
      asMockedFunction(processMessageContents).mockResolvedValue(['processed', [], []])

      await service.sendChat({ client: viewer.client, sessionId: session.id, text: 'hello' })

      expect(fakeNydus.publish).toHaveBeenCalledWith(getReplaySessionPath(session.id), {
        type: 'chat',
        message: { time: expect.any(Number), from: VIEWER.id, text: 'processed' },
        mentions: [],
        channelMentions: [],
      })
    })

    test('refuses chat from a restricted user', async () => {
      const session = await sessionWithViewer()
      isChatRestricted = true

      await expect(
        service.sendChat({ client: viewer.client, sessionId: session.id, text: 'hello' }),
      ).rejects.toMatchObject({ code: ReplaySessionErrorCode.ChatRestricted })
    })
  })

  describe('source retention', () => {
    test('retains uploaded sources and ends sessions whose source expired', async () => {
      const session = await service.createSession({
        client: host.client,
        source: { kind: 'upload', sourceId: upload().id },
      })
      await createGameSessionFor(viewer)
      sourceService.retainSources.mockResolvedValue(new Set())

      await service.retainUploadedSources()

      expect(sourceService.retainSources).toHaveBeenCalledWith([upload().id])
      expect(latest(session.id).state).toBe('ended')
    })

    async function createGameSessionFor(sockets: Sockets) {
      asMockedFunction(getGameRecord).mockResolvedValue(
        lobbyGame({ listed: true, participants: [] }),
      )
      return await service.createSession({
        client: sockets.client,
        source: { kind: 'game', gameId: 'game-id' },
      })
    }
  })
})
