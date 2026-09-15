import { atom } from 'jotai'
import { assertUnreachable } from '../../common/assert-unreachable'
import { SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommandContext } from './commands/command-context'

/**
 * Which conversation a session-only message belongs in. Each chat surface keeps its messages in its
 * own store, so this is what tells the three of them apart.
 */
export type LocalMessageTarget =
  | { surface: 'channel'; channelId: SbChannelId }
  | { surface: 'whisper'; userId: SbUserId }
  /** The one lobby this client can be in at a time, which needs nothing to identify it. */
  | { surface: 'lobby' }

/** The conversation a command run in `context` answers into. */
export function localMessageTargetFor(context: CommandContext): LocalMessageTarget {
  switch (context.surface) {
    case 'channel':
      return { surface: 'channel', channelId: context.channelId }
    case 'whisper':
      return { surface: 'whisper', userId: context.targetId }
    case 'lobby':
      return { surface: 'lobby' }
    default:
      return assertUnreachable(context)
  }
}

/**
 * A string two targets share exactly when they name the same conversation, for comparing targets
 * that are rebuilt from scratch on every render and so never share an identity.
 */
export function localMessageTargetKey(target: LocalMessageTarget): string {
  switch (target.surface) {
    case 'channel':
      return `channel:${target.channelId}`
    case 'whisper':
      return `whisper:${target.userId}`
    case 'lobby':
      return 'lobby'
    default:
      return assertUnreachable(target)
  }
}

/**
 * The chat surface most recently on screen, which is where a message that has no conversation of
 * its own (an echoed whisper) is shown. Kept after that surface unmounts, so a whisper arriving
 * while the user is off on some other page lands in the conversation they'll come back to rather
 * than nowhere at all. Cleared on logout, since a conversation belongs to the account that was in
 * it.
 */
export const lastChatSurfaceAtom = atom<LocalMessageTarget | undefined>(undefined)
