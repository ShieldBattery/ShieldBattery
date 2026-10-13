import { randomUUID } from 'crypto'
import { singleton } from 'tsyringe'
import { encodePrettyId } from '../../../common/pretty-id'
import {
  GetReplaySessionSourceResponse,
  makeSbReplaySessionId,
  ReplaySessionErrorCode,
  ReplaySessionEvent,
  ReplaySessionInviteJson,
  ReplaySessionInvitesEvent,
  ReplaySessionJson,
  ReplaySessionPlaybackJson,
  ReplaySessionSource,
  ReplaySessionSourceInfo,
  ReplaySessionState,
  SbReplaySessionId,
} from '../../../common/replay-sessions'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { toBasicChannelInfo } from '../chat/chat-models'
import { CodedError } from '../errors/coded-error'
import { getSignedUrl } from '../files'
import { getGameRecord } from '../games/game-models'
import logger from '../logging/logger'
import filterChatMessage from '../messaging/filter-chat-message'
import { processMessageContents } from '../messaging/process-chat-message'
import { Clock } from '../time/clock'
import { RestrictionService } from '../users/restriction-service'
import {
  ClientSocketsGroup,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { replayPath } from './paths'
import { canUserAccessReplay } from './replay-access'
import { getBestReplayForGame } from './replay-models'
import {
  replaySessionSourceMetadata,
  ReplaySessionSourceService,
  replaySessionUploadPath,
} from './replay-session-source-service'

export class ReplaySessionServiceError extends CodedError<ReplaySessionErrorCode> {}

/** How long a member's replay download URL stays valid. */
const SOURCE_DOWNLOAD_URL_LIFETIME_SECONDS = 5 * 60

/** The channel every client in a replay session is subscribed to. */
export function getReplaySessionPath(sessionId: SbReplaySessionId): string {
  return urlPath`/replay-sessions/${sessionId}`
}

/** The channel carrying a user's pending replay session invites, across all of their clients. */
export function getReplaySessionInvitesPath(userId: SbUserId): string {
  return urlPath`/replay-session-invites/${userId}`
}

/**
 * A session's replay, fixed when the session is created so that every member downloads and
 * verifies the same bytes.
 */
type ResolvedSource =
  | { kind: 'game'; gameId: string; replayFileId: string; hash: string; size: number }
  | { kind: 'upload'; sourceId: string; hash: string; size: number }

interface Member {
  userId: SbUserId
  /** The client the member joined from; it is the one that downloads and plays the replay. */
  client: ClientSocketsGroup
  loaded: boolean
}

interface ReplaySession {
  id: SbReplaySessionId
  revision: number
  state: Exclude<ReplaySessionState, 'ended'>
  hostId: SbUserId
  source: ResolvedSource
  sourceInfo: ReplaySessionSourceInfo
  /** Members in the order they joined, which is the order the host role passes down in. */
  members: Map<SbUserId, Member>
  invited: Set<SbUserId>
  playback: ReplaySessionPlaybackJson
}

function toJson(
  session: ReplaySession,
  state: ReplaySessionState = session.state,
): ReplaySessionJson {
  return {
    id: session.id,
    revision: session.revision,
    state,
    hostId: session.hostId,
    source: session.sourceInfo,
    members: Array.from(session.members.values(), m => ({ userId: m.userId, loaded: m.loaded })),
    invitedUserIds: Array.from(session.invited),
    playback: { ...session.playback },
  }
}

/**
 * Runs replay sessions: rooms in which a host and the viewers they invite watch the same replay
 * together, each playing it locally. The service is the control plane only. It decides who is in a
 * session, which replay bytes they play, when playback can begin, and who controls it.
 *
 * Membership is per-client, since the client that joins is the one that downloads and plays the
 * replay, and a user can be in at most one session at a time. Access to a ShieldBattery game's
 * replay is checked for every member individually, so an invite never grants access to a replay
 * its recipient couldn't otherwise download.
 */
@singleton()
export class ReplaySessionService {
  private readonly sessions = new Map<SbReplaySessionId, ReplaySession>()
  private readonly userSessions = new Map<SbUserId, SbReplaySessionId>()

  constructor(
    private publisher: TypedPublisher<ReplaySessionEvent | ReplaySessionInvitesEvent>,
    private sourceService: ReplaySessionSourceService,
    private restrictionService: RestrictionService,
    private userSockets: UserSocketsManager,
    private clock: Clock,
  ) {
    this.userSockets.on('newUser', user => this.subscribeUserToInvites(user))
  }

  /** Creates a session hosted by `client`'s user, who becomes its first member. */
  async createSession({
    client,
    source,
  }: {
    client: ClientSocketsGroup
    source: ReplaySessionSource
  }): Promise<ReplaySessionJson> {
    this.ensureNotInSession(client.userId)

    const resolved = await this.resolveSource(source, client.userId)

    // Resolving the source is async, so another request may have put the user in a session
    this.ensureNotInSession(client.userId)

    const session: ReplaySession = {
      id: makeSbReplaySessionId(encodePrettyId(randomUUID())),
      revision: 0,
      state: 'gathering',
      hostId: client.userId,
      source: resolved.source,
      sourceInfo: resolved.info,
      members: new Map(),
      invited: new Set(),
      playback: { epoch: 0, frame: 0, paused: false, speed: 1 },
    }
    this.sessions.set(session.id, session)
    this.addMember(session, client)

    return toJson(session)
  }

  /** Invites a user to the host's session, as long as they could access its replay themselves. */
  async invite({
    client,
    sessionId,
    targetId,
  }: {
    client: ClientSocketsGroup
    sessionId: SbReplaySessionId
    targetId: SbUserId
  }): Promise<void> {
    let session = this.getSessionForHost(client, sessionId)
    this.ensureAdmitting(session)
    if (session.members.has(targetId) || session.invited.has(targetId)) {
      return
    }

    if (!(await this.canAccessSource(session.source, targetId))) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.TargetCannotAccessReplay,
        'that user cannot access this replay',
      )
    }

    session = this.getSessionForHost(client, sessionId)
    this.ensureAdmitting(session)
    if (session.members.has(targetId) || session.invited.has(targetId)) {
      return
    }

    session.invited.add(targetId)
    this.publishSnapshot(session)
    this.publishInvites(targetId)
  }

  /** Withdraws a user's own invite to a session. */
  declineInvite({ userId, sessionId }: { userId: SbUserId; sessionId: SbReplaySessionId }): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.invited.delete(userId)) {
      return
    }

    this.publishSnapshot(session)
    this.publishInvites(userId)
  }

  /** Admits an invited user's client to a session that hasn't begun playing yet. */
  async joinSession({
    client,
    sessionId,
  }: {
    client: ClientSocketsGroup
    sessionId: SbReplaySessionId
  }): Promise<ReplaySessionJson> {
    this.ensureNotInSession(client.userId)
    const pending = this.getInvitedSession(client.userId, sessionId)

    if (!(await this.canAccessSource(pending.source, client.userId))) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.ReplayNotAccessible,
        'you cannot access this replay',
      )
    }

    // Checking access is async, so the session or the user's own state may have moved on
    this.ensureNotInSession(client.userId)
    const session = this.getInvitedSession(client.userId, sessionId)

    session.invited.delete(client.userId)
    this.addMember(session, client)
    this.publishInvites(client.userId)

    return toJson(session)
  }

  /** Moves a gathering session into loading, after which it plays once every member has loaded. */
  start({ client, sessionId }: { client: ClientSocketsGroup; sessionId: SbReplaySessionId }): void {
    const session = this.getSessionForHost(client, sessionId)
    if (session.state !== 'gathering') {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.AlreadyStarted,
        'this session has already started',
      )
    }

    session.state = 'loading'
    this.maybeBeginViewing(session)
    this.publishSnapshot(session)
  }

  /**
   * Records that a member's client has loaded the session's replay. The client reports the hash of
   * the bytes it loaded, which must be the session's: playing anything else would put that viewer
   * out of step with everyone else.
   */
  reportLoaded({
    client,
    sessionId,
    hash,
  }: {
    client: ClientSocketsGroup
    sessionId: SbReplaySessionId
    hash: string
  }): void {
    const session = this.getSessionForClient(client, sessionId)
    if (session.state !== 'loading') {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.NotLoading,
        'this session is not loading',
      )
    }
    if (hash.toLowerCase() !== session.source.hash) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.HashMismatch,
        "the loaded replay does not match this session's replay",
      )
    }

    const member = session.members.get(client.userId)!
    if (member.loaded) {
      return
    }

    member.loaded = true
    this.maybeBeginViewing(session)
    this.publishSnapshot(session)
  }

  /** Removes a member's client from their session. */
  leaveSession({
    client,
    sessionId,
  }: {
    client: ClientSocketsGroup
    sessionId: SbReplaySessionId
  }): void {
    const session = this.getSessionForClient(client, sessionId)
    this.removeMember(session, client.userId)
  }

  /** Ends the host's session for everyone in it. */
  closeSession({
    client,
    sessionId,
  }: {
    client: ClientSocketsGroup
    sessionId: SbReplaySessionId
  }): void {
    const session = this.getSessionForHost(client, sessionId)
    this.endSession(session)
  }

  async sendChat({
    client,
    sessionId,
    text,
  }: {
    client: ClientSocketsGroup
    sessionId: SbReplaySessionId
    text: string
  }): Promise<void> {
    this.getSessionForClient(client, sessionId)

    const isChatRestricted = await this.restrictionService.isRestricted(
      client.userId,
      RestrictionKind.Chat,
    )
    if (isChatRestricted) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.ChatRestricted,
        'You are currently restricted from sending chat messages',
      )
    }

    const [processedText, userMentions, channelMentions] = await processMessageContents(
      filterChatMessage(text),
    )

    // Processing the message is async, so the sender may have left in the meantime
    const session = this.getSessionForClient(client, sessionId)
    this.publisher.publish(getReplaySessionPath(session.id), {
      type: 'chat',
      message: { time: this.clock.now(), from: client.userId, text: processedText },
      mentions: userMentions,
      channelMentions: channelMentions.map(c => toBasicChannelInfo(c)),
    })
  }

  /**
   * Returns a short-lived download URL for a member's session replay. Access to a game's replay is
   * checked again here, so membership alone never stands in for it.
   */
  async getSourceDownload({
    userId,
    sessionId,
  }: {
    userId: SbUserId
    sessionId: SbReplaySessionId
  }): Promise<GetReplaySessionSourceResponse> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.members.has(userId)) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.NotInSession,
        'you are not in this session',
      )
    }

    const { source } = session
    if (!(await this.canAccessSource(source, userId))) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.ReplayNotAccessible,
        'you cannot access this replay',
      )
    }

    const path =
      source.kind === 'game'
        ? replayPath(source.replayFileId)
        : replaySessionUploadPath(source.sourceId)
    const url = await getSignedUrl(path, {
      expires: SOURCE_DOWNLOAD_URL_LIFETIME_SECONDS,
      contentType: 'application/octet-stream',
    })

    return { url, hash: source.hash, size: source.size }
  }

  /**
   * Keeps every uploaded source an active session plays from alive. A session whose source could
   * not be retained has lost its replay, so it is ended.
   */
  async retainUploadedSources(): Promise<void> {
    const sourceIds = new Set<string>()
    for (const session of this.sessions.values()) {
      if (session.source.kind === 'upload') {
        sourceIds.add(session.source.sourceId)
      }
    }
    if (!sourceIds.size) {
      return
    }

    const retained = await this.sourceService.retainSources(Array.from(sourceIds))
    for (const session of Array.from(this.sessions.values())) {
      if (session.source.kind === 'upload' && !retained.has(session.source.sourceId)) {
        logger.warn(
          { sessionId: session.id, sourceId: session.source.sourceId },
          'ending replay session whose uploaded source expired',
        )
        this.endSession(session)
      }
    }
  }

  private async resolveSource(
    source: ReplaySessionSource,
    hostId: SbUserId,
  ): Promise<{ source: ResolvedSource; info: ReplaySessionSourceInfo }> {
    if (source.kind === 'upload') {
      const upload = await this.sourceService.retainSourceForOwner(source.sourceId, hostId)
      if (!upload) {
        throw new ReplaySessionServiceError(
          ReplaySessionErrorCode.SourceNotFound,
          'that replay could not be found',
        )
      }

      return {
        source: {
          kind: 'upload',
          sourceId: upload.id,
          hash: upload.hash.toString('hex'),
          size: upload.size,
        },
        info: { kind: 'upload', metadata: replaySessionSourceMetadata(upload.header) },
      }
    }

    const game = await getGameRecord(source.gameId)
    if (!game || !canUserAccessReplay(game, hostId)) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.ReplayNotAccessible,
        'you cannot access this replay',
      )
    }
    const replay = await getBestReplayForGame(source.gameId)
    if (!replay) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.SourceNotFound,
        'that game has no replay',
      )
    }

    return {
      source: {
        kind: 'game',
        gameId: source.gameId,
        replayFileId: replay.id,
        hash: replay.hash.toString('hex'),
        size: replay.size,
      },
      info: {
        kind: 'game',
        gameId: source.gameId,
        metadata: replaySessionSourceMetadata(replay.header),
      },
    }
  }

  /**
   * Whether a user may watch a session's replay. A game's replay follows the game's own replay
   * access rules; an uploaded replay is shared with whoever its owner admits to the session.
   */
  private async canAccessSource(source: ResolvedSource, userId: SbUserId): Promise<boolean> {
    if (source.kind === 'upload') {
      return true
    }

    const game = await getGameRecord(source.gameId)
    return !!game && canUserAccessReplay(game, userId)
  }

  private ensureNotInSession(userId: SbUserId): void {
    if (this.userSessions.has(userId)) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.AlreadyInSession,
        'you are already in a replay session',
      )
    }
  }

  private ensureAdmitting(session: ReplaySession): void {
    if (session.state === 'viewing') {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.AlreadyStarted,
        'this session is already playing',
      )
    }
  }

  private getInvitedSession(userId: SbUserId, sessionId: SbReplaySessionId): ReplaySession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.SessionNotFound,
        'that session no longer exists',
      )
    }
    if (!session.invited.has(userId)) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.NotInvited,
        'you have not been invited to this session',
      )
    }
    this.ensureAdmitting(session)
    return session
  }

  /**
   * Returns the session `client` is a member of, asserting it is `sessionId` so that a stale
   * client can't act on a session its user has since moved on from.
   */
  private getSessionForClient(
    client: ClientSocketsGroup,
    sessionId: SbReplaySessionId,
  ): ReplaySession {
    const session = this.sessions.get(sessionId)
    if (
      !session ||
      this.userSessions.get(client.userId) !== sessionId ||
      session.members.get(client.userId)?.client !== client
    ) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.NotInSession,
        'you are not in this session',
      )
    }
    return session
  }

  private getSessionForHost(
    client: ClientSocketsGroup,
    sessionId: SbReplaySessionId,
  ): ReplaySession {
    const session = this.getSessionForClient(client, sessionId)
    if (session.hostId !== client.userId) {
      throw new ReplaySessionServiceError(
        ReplaySessionErrorCode.NotHost,
        'only the host can do that',
      )
    }
    return session
  }

  private addMember(session: ReplaySession, client: ClientSocketsGroup): void {
    session.members.set(client.userId, { userId: client.userId, client, loaded: false })
    this.userSessions.set(client.userId, session.id)

    // Each subscriber's initial data is the current snapshot, so the joining client gets the whole
    // session even if it misses the publish below.
    client.subscribe<ReplaySessionEvent>(
      getReplaySessionPath(session.id),
      async () => {
        const current = this.sessions.get(session.id)
        return current ? { type: 'snapshot', session: toJson(current) } : undefined
      },
      closed => {
        const current = this.sessions.get(session.id)
        if (current?.members.get(closed.userId)?.client === closed) {
          this.removeMember(current, closed.userId)
        }
      },
    )
    this.publishSnapshot(session)
  }

  /**
   * Removes a member, passing the host role to the longest-standing remaining member if the host
   * left. A new controller pauses playback, since viewers can't tell where they meant to resume.
   */
  private removeMember(session: ReplaySession, userId: SbUserId): void {
    const member = session.members.get(userId)
    if (!member) {
      return
    }

    session.members.delete(userId)
    this.userSessions.delete(userId)
    member.client.unsubscribe(getReplaySessionPath(session.id))

    const nextHost = session.members.values().next().value
    if (!nextHost) {
      this.endSession(session)
      return
    }

    if (session.hostId === userId) {
      session.hostId = nextHost.userId
      if (session.state === 'viewing') {
        session.playback = {
          ...session.playback,
          epoch: session.playback.epoch + 1,
          paused: true,
        }
      }
      // Invites name the session's host, so outstanding ones have changed too
      for (const invitedId of session.invited) {
        this.publishInvites(invitedId)
      }
    }

    this.maybeBeginViewing(session)
    this.publishSnapshot(session)
  }

  /** Begins playback once a loading session's members have all loaded its replay. */
  private maybeBeginViewing(session: ReplaySession): void {
    if (session.state !== 'loading') {
      return
    }
    for (const member of session.members.values()) {
      if (!member.loaded) {
        return
      }
    }

    session.state = 'viewing'
    this.clearInvites(session)
  }

  private endSession(session: ReplaySession): void {
    this.sessions.delete(session.id)
    this.clearInvites(session)

    session.revision++
    const path = getReplaySessionPath(session.id)
    this.publisher.publish(path, { type: 'snapshot', session: toJson(session, 'ended') })
    for (const member of session.members.values()) {
      this.userSessions.delete(member.userId)
      member.client.unsubscribe(path)
    }
    session.members.clear()
  }

  private clearInvites(session: ReplaySession): void {
    const invited = Array.from(session.invited)
    session.invited.clear()
    for (const userId of invited) {
      this.publishInvites(userId)
    }
  }

  private publishSnapshot(session: ReplaySession): void {
    session.revision++
    this.publisher.publish(getReplaySessionPath(session.id), {
      type: 'snapshot',
      session: toJson(session),
    })
  }

  private invitesFor(userId: SbUserId): ReplaySessionInviteJson[] {
    const invites: ReplaySessionInviteJson[] = []
    for (const session of this.sessions.values()) {
      if (session.invited.has(userId)) {
        invites.push({ sessionId: session.id, hostId: session.hostId, source: session.sourceInfo })
      }
    }
    return invites
  }

  private publishInvites(userId: SbUserId): void {
    this.publisher.publish(getReplaySessionInvitesPath(userId), {
      type: 'invites',
      invites: this.invitesFor(userId),
    })
  }

  private subscribeUserToInvites(user: UserSocketsGroup): void {
    user.subscribe<ReplaySessionInvitesEvent>(getReplaySessionInvitesPath(user.userId), () => ({
      type: 'invites',
      invites: this.invitesFor(user.userId),
    }))
  }
}
