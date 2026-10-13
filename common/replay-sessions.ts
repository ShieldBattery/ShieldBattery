import { Tagged } from 'type-fest'
import { BasicChannelInfo } from './chat'
import { SbUser } from './users/sb-user'
import { SbUserId } from './users/sb-user-id'

/** Metadata for a replay a replay session can play. */
export interface ReplaySessionSourceMetadata {
  mapName: string
  gameType: string
  durationFrames: number
}

/**
 * The response from staging a local replay for a future multiplayer replay session.
 *
 * `sourceId` is only useful to the owner while it remains unexpired. It is intentionally not a
 * download capability: the staged object's storage path and URL never leave the server here.
 */
export interface StageReplaySessionSourceResponse {
  sourceId: string
  hash: string
  size: number
  metadata: ReplaySessionSourceMetadata
}

/**
 * A replay session's id, generated server-side as a pretty-encoded random UUID. Sessions are
 * ephemeral, so this is their identity everywhere (registries, wire protocol, routes).
 */
export type SbReplaySessionId = Tagged<string, 'SbReplaySessionId'>

/**
 * Converts a replay session id string into a properly typed version. Alternative methods of
 * retrieving an SbReplaySessionId should be preferred, such as using a value from the server.
 */
export function makeSbReplaySessionId(id: string): SbReplaySessionId {
  return id as SbReplaySessionId
}

/**
 * The replay a host asks to watch: the best replay stored for a ShieldBattery game, or a local
 * replay the host staged through the sources endpoint.
 */
export type ReplaySessionSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'upload'; sourceId: string }

/**
 * What every member of a session may know about its replay. An uploaded source's id is its
 * owner's alone, so it is never part of this.
 */
export type ReplaySessionSourceInfo =
  | { kind: 'game'; gameId: string; metadata: ReplaySessionSourceMetadata }
  | { kind: 'upload'; metadata: ReplaySessionSourceMetadata }

/**
 * A session's lifecycle. `gathering` admits invited viewers; `loading` waits for every member to
 * load the replay (and still admits invited viewers, who must then load it too); `viewing` plays
 * it. `ended` is only ever seen as a session's final snapshot.
 */
export type ReplaySessionState = 'gathering' | 'loading' | 'viewing' | 'ended'

export interface ReplaySessionMemberJson {
  userId: SbUserId
  /** Whether this member has loaded the session's replay and confirmed its hash. */
  loaded: boolean
}

/**
 * The room-wide playback position. `epoch` increments whenever the timeline is moved out from
 * under viewers (a seek or a change of controller), so frame reports from an older epoch can be
 * told apart from current ones.
 */
export interface ReplaySessionPlaybackJson {
  epoch: number
  frame: number
  paused: boolean
  speed: number
}

export interface ReplaySessionJson {
  id: SbReplaySessionId
  /** Increments with every change to the session, so a stale snapshot can be discarded. */
  revision: number
  state: ReplaySessionState
  /** The member who controls the session and its playback. */
  hostId: SbUserId
  source: ReplaySessionSourceInfo
  members: ReplaySessionMemberJson[]
  invitedUserIds: SbUserId[]
  playback: ReplaySessionPlaybackJson
}

export interface ReplaySessionChatMessage {
  time: number
  from: SbUserId
  text: string
}

/** The events published on a session's channel to every client in it. */
export type ReplaySessionEvent =
  | { type: 'snapshot'; session: ReplaySessionJson }
  | {
      type: 'chat'
      message: ReplaySessionChatMessage
      mentions: SbUser[]
      channelMentions: BasicChannelInfo[]
    }

export interface ReplaySessionInviteJson {
  sessionId: SbReplaySessionId
  hostId: SbUserId
  source: ReplaySessionSourceInfo
}

/** The event published on a user's invite channel: every invite they currently hold. */
export interface ReplaySessionInvitesEvent {
  type: 'invites'
  invites: ReplaySessionInviteJson[]
}

export interface CreateReplaySessionRequest {
  clientId: string
  source: ReplaySessionSource
}

export interface CreateReplaySessionResponse {
  session: ReplaySessionJson
}

export interface ReplaySessionClientRequest {
  clientId: string
}

export interface InviteToReplaySessionRequest {
  clientId: string
  targetId: SbUserId
}

export interface ReportReplaySessionLoadedRequest {
  clientId: string
  hash: string
}

export interface SendReplaySessionChatRequest {
  clientId: string
  text: string
}

/**
 * A short-lived capability for one member to download the session's replay. Clients must check the
 * downloaded bytes against `hash` before loading them.
 */
export interface GetReplaySessionSourceResponse {
  url: string
  hash: string
  size: number
}

export enum ReplaySessionErrorCode {
  AlreadyInSession = 'AlreadyInSession',
  AlreadyStarted = 'AlreadyStarted',
  ChatRestricted = 'ChatRestricted',
  HashMismatch = 'HashMismatch',
  NoActiveClient = 'NoActiveClient',
  NotHost = 'NotHost',
  NotInvited = 'NotInvited',
  NotInSession = 'NotInSession',
  NotLoading = 'NotLoading',
  ReplayNotAccessible = 'ReplayNotAccessible',
  SessionNotFound = 'SessionNotFound',
  SourceNotFound = 'SourceNotFound',
  TargetCannotAccessReplay = 'TargetCannotAccessReplay',
}
