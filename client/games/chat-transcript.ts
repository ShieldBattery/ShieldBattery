import { ReadonlyDeep } from 'type-fest'
import { GameConfigPlayer } from '../../common/games/configuration'
import { GameType, isTeamType } from '../../common/games/game-type'
import { ReplayChat, ReplayChatMessage, ReplayChatPlayer } from '../../common/replays'
import { SbUserId } from '../../common/users/sb-user-id'

/**
 * How far apart (in frames) the same sender's identical message can be recorded in two different
 * replays and still be treated as one message. Each client records a message when it arrives
 * there, so a recipient's copy trails the sender's by the delivery time.
 */
const SAME_MESSAGE_FRAME_WINDOW = 72

/**
 * Who a chat message was sent to, inferred from which sides' replays recorded it: `all` if some
 * side other than the sender's saw it, `team` if only the sender's side did even though another
 * side's replay was still recording, and `unknown` if no other side's replay could have seen it.
 */
export type ChatScope = 'all' | 'team' | 'unknown'

export interface ChatTranscriptMessageLine {
  kind: 'chat'
  frame: number
  senderSlot: number
  text: string
  scope: ChatScope
}

export interface ChatTranscriptLeaveLine {
  kind: 'leave'
  frame: number
  slotId: number
  dropped: boolean
}

export type ChatTranscriptLine = ChatTranscriptMessageLine | ChatTranscriptLeaveLine

export interface ChatTranscript {
  /** The game's players and observers, keyed by the slot their messages and leaves name. */
  players: Map<number, ReplayChatPlayer>
  /** The chat messages and leaves, in frame order. */
  lines: ChatTranscriptLine[]
}

/** One replay's chat and leaves, tagged with the side of the player who recorded it. */
export interface ChatTranscriptSource {
  /** Index into the sides from {@link getChatSides}. */
  side: number
  chat: ReadonlyDeep<ReplayChat>
}

/**
 * Groups a game's human players into the sides whose replays a chat transcript compares: the
 * configured teams for a team game type, and otherwise every player on their own.
 */
export function getChatSides(
  config: ReadonlyDeep<{ gameType: GameType; teams: GameConfigPlayer[][] }>,
): SbUserId[][] {
  const teams = config.teams.map(team => team.filter(p => !p.isComputer).map(p => p.id))
  const sides = isTeamType(config.gameType) ? teams : teams.flat().map(id => [id])
  return sides.filter(side => side.length > 0)
}

/**
 * Picks the replay to read each side's chat from: the longest one uploaded by a member of that
 * side, since it recorded the most of the game. Sides with no uploaded replay are left out, as are
 * replays uploaded by anyone not on a side (e.g. observers).
 */
export function selectChatTranscriptReplays<
  R extends ReadonlyDeep<{ uploadedByUserId: SbUserId; frames: number | null }>,
>(sides: ReadonlyArray<ReadonlyArray<SbUserId>>, replays: ReadonlyArray<R>) {
  const selected: Array<{ side: number; replay: R }> = []
  for (let side = 0; side < sides.length; side++) {
    let longest: R | undefined
    for (const replay of replays) {
      if (
        sides[side].includes(replay.uploadedByUserId) &&
        (!longest || (replay.frames ?? -1) > (longest.frames ?? -1))
      ) {
        longest = replay
      }
    }
    if (longest) {
      selected.push({ side, replay: longest })
    }
  }
  return selected
}

interface MergedMessage {
  senderSlot: number
  text: string
  /** The frame the message is shown at, preferring the sender's own side's copy. */
  frame: number
  /** The frame of the first copy recorded, which later copies are matched against. */
  matchFrame: number
  seenBySides: Set<number>
}

/**
 * Merges the chat and leaves from each side's replay into one transcript, collapsing the copies of
 * a message or leave that several replays recorded and inferring each message's {@link ChatScope}
 * from which sides recorded it.
 */
export function buildChatTranscript(
  sources: ReadonlyArray<ChatTranscriptSource>,
  sides: ReadonlyArray<ReadonlyArray<SbUserId>>,
): ChatTranscript {
  // A replay records the colors its recording player was shown, which a team-color preset (e.g.
  // self/allies/enemies) can replace with a palette that repeats colors. The game's real colors
  // never repeat, so colors are taken from the first replay whose players' colors are distinct.
  const colorSource =
    sources.find(({ chat }) => {
      const colors = chat.players.filter(p => !p.isObserver).map(p => p.color)
      return new Set(colors).size === colors.length
    }) ?? sources.at(0)
  const players = new Map<number, ReplayChatPlayer>()
  for (const { chat } of sources) {
    for (const player of chat.players) {
      if (!players.has(player.slotId)) {
        const color = colorSource?.chat.players.find(p => p.slotId === player.slotId)?.color
        players.set(player.slotId, { ...player, color })
      }
    }
  }

  const sideByUserId = new Map<SbUserId, number>()
  sides.forEach((side, i) => side.forEach(userId => sideByUserId.set(userId, i)))
  const getSenderSide = (senderSlot: number) => {
    const userId = players.get(senderSlot)?.userId
    return userId !== undefined ? sideByUserId.get(userId) : undefined
  }

  // Copies of one message are only ever matched among messages with the same sender and text.
  // Within such a group every replay records the copies in the same order, so matching walks the
  // already-merged messages and a replay's copies together, in frame order.
  const merged = new Map<string, MergedMessage[]>()
  for (const { side, chat } of sources) {
    const incomingByKey = new Map<string, Array<ReadonlyDeep<ReplayChatMessage>>>()
    for (const message of chat.messages) {
      const key = `${message.senderSlot}:${message.text}`
      const group = incomingByKey.get(key)
      if (group) {
        group.push(message)
      } else {
        incomingByKey.set(key, [message])
      }
    }

    for (const [key, incoming] of incomingByKey) {
      const existing = merged.get(key) ?? []
      const result: MergedMessage[] = []
      let i = 0
      let j = 0
      while (i < existing.length || j < incoming.length) {
        const current = existing.at(i)
        const message = incoming.at(j)
        if (
          current &&
          message &&
          Math.abs(current.matchFrame - message.frame) <= SAME_MESSAGE_FRAME_WINDOW
        ) {
          current.seenBySides.add(side)
          if (side === getSenderSide(message.senderSlot)) {
            current.frame = message.frame
          }
          result.push(current)
          i++
          j++
        } else if (message && (!current || message.frame < current.matchFrame)) {
          result.push({
            senderSlot: message.senderSlot,
            text: message.text,
            frame: message.frame,
            matchFrame: message.frame,
            seenBySides: new Set([side]),
          })
          j++
        } else {
          result.push(current!)
          i++
        }
      }
      merged.set(key, result)
    }
  }

  const messageLines = Array.from(merged.values(), group =>
    group.map<ChatTranscriptLine>(message => {
      const senderSide = getSenderSide(message.senderSlot)
      let scope: ChatScope
      if (Array.from(message.seenBySides).some(side => side !== senderSide)) {
        scope = 'all'
      } else if (
        sources.some(
          s => s.side !== senderSide && s.chat.frames >= message.frame + SAME_MESSAGE_FRAME_WINDOW,
        )
      ) {
        scope = 'team'
      } else {
        scope = 'unknown'
      }
      return {
        kind: 'chat',
        frame: message.frame,
        senderSlot: message.senderSlot,
        text: message.text,
        scope,
      }
    }),
  ).flat()

  // Leaves are game commands, so every replay that recorded one has it at the same frame, and a
  // player can only leave once: the first copy of each player's leave is the only one needed.
  const leaves = new Map<number, ChatTranscriptLeaveLine>()
  for (const { chat } of sources) {
    for (const { frame, slotId, dropped } of chat.leaves) {
      if (!leaves.has(slotId)) {
        leaves.set(slotId, { kind: 'leave', frame, slotId, dropped })
      }
    }
  }

  // The sort is stable, so a leave on the same frame as a message stays after it.
  const lines = [...messageLines, ...leaves.values()].sort((a, b) => a.frame - b.frame)
  return { players, lines }
}
