import { SbChannelId } from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'

/** The kinds of chat surface a command can run in. */
export type CommandSurface = 'channel' | 'whisper' | 'lobby'

/** A user the command layer can resolve a typed name against. */
export interface CommandUserEntry {
  id: SbUserId
  name: string
  /** Whether the user is currently online, which the argument palette fades offline users by. */
  online: boolean
}

/**
 * What a chat channel tells the command layer about itself. Built by the channel surface and handed
 * down through `Chat`, so the command layer never reads a surface's store state on its own.
 */
export interface ChannelCommandContext {
  surface: 'channel'
  channelId: SbChannelId
  selfUserId: SbUserId
  /**
   * Every member the client knows of (online, idle or offline). Targets typed into commands resolve
   * against this list to a confirmed id; a name not on it is an error, never a guess.
   */
  members: ReadonlyArray<CommandUserEntry>
  /**
   * Whether the member-list menu would offer this user an enabled Kick action here: the channel
   * owner, a server moderator, or a member holding the `editPermissions` or `kick` permission.
   */
  canKick: boolean
  /** Same as `canKick`, for Ban (`editPermissions` or `ban`). */
  canBan: boolean
}

export interface WhisperCommandContext {
  surface: 'whisper'
  selfUserId: SbUserId
  /** The other user in the conversation. */
  targetId: SbUserId
}

export interface LobbyCommandContext {
  surface: 'lobby'
  selfUserId: SbUserId
}

export type CommandContext = ChannelCommandContext | WhisperCommandContext | LobbyCommandContext
