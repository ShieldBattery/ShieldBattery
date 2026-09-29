import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { RaceChar } from '../../common/races'
import { ReplayChat, ReplayChatMessage, ReplayChatPlayer, ReplayLeave } from '../../common/replays'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import {
  buildChatTranscript,
  ChatScope,
  ChatTranscriptLine,
  getChatSides,
  selectChatTranscriptReplays,
} from './chat-transcript'

const A1 = makeSbUserId(1)
const A2 = makeSbUserId(2)
const B1 = makeSbUserId(3)
const B2 = makeSbUserId(4)

function configPlayer(id: SbUserId, isComputer = false) {
  return { id, race: 'p' as RaceChar, isComputer }
}

describe('client/games/chat-transcript/getChatSides', () => {
  test('uses the configured teams for team game types', () => {
    expect(
      getChatSides({
        gameType: GameType.TopVsBottom,
        teams: [
          [configPlayer(A1), configPlayer(A2)],
          [configPlayer(B1), configPlayer(B2)],
        ],
      }),
    ).toEqual([
      [A1, A2],
      [B1, B2],
    ])
  })

  test('puts every player on their own side for non-team game types', () => {
    expect(
      getChatSides({
        gameType: GameType.Melee,
        teams: [[configPlayer(A1), configPlayer(B1), configPlayer(makeSbUserId(0), true)]],
      }),
    ).toEqual([[A1], [B1]])
    expect(
      getChatSides({
        gameType: GameType.OneVsOne,
        teams: [[configPlayer(A1)], [configPlayer(B1)]],
      }),
    ).toEqual([[A1], [B1]])
  })
})

describe('client/games/chat-transcript/selectChatTranscriptReplays', () => {
  test("picks each side's longest replay and skips replays from outside the sides", () => {
    const replays = [
      { id: 'a1', uploadedByUserId: A1, frames: 100 },
      { id: 'a2', uploadedByUserId: A2, frames: 200 },
      { id: 'b1', uploadedByUserId: B1, frames: null },
      { id: 'obs', uploadedByUserId: makeSbUserId(99), frames: 500 },
    ]
    const selected = selectChatTranscriptReplays([[A1, A2], [B1, B2], [makeSbUserId(5)]], replays)

    expect(selected.map(({ side, replay }) => [side, replay.id])).toEqual([
      [0, 'a2'],
      [1, 'b1'],
    ])
  })
})

const SIDES = [
  [A1, A2],
  [B1, B2],
]

const PLAYERS: ReplayChatPlayer[] = [
  { slotId: 0, name: 'a1', isObserver: false, userId: A1, color: '#f40404' },
  { slotId: 1, name: 'b1', isObserver: false, userId: B1, color: '#0c48cc' },
  { slotId: 2, name: 'a2', isObserver: false, userId: A2, color: '#2cb494' },
  { slotId: 3, name: 'b2', isObserver: false, userId: B2, color: '#88409c' },
]

function chat(
  frames: number,
  messages: Array<[number, number, string]>,
  leaves: ReplayLeave[] = [],
): ReplayChat {
  return {
    frames,
    players: PLAYERS,
    messages: messages.map<ReplayChatMessage>(([frame, senderSlot, text]) => ({
      frame,
      senderSlot,
      text,
    })),
    leaves,
  }
}

function lines(...entries: Array<[number, number, string, ChatScope]>): ChatTranscriptLine[] {
  return entries.map(([frame, senderSlot, text, scope]) => ({
    kind: 'chat',
    frame,
    senderSlot,
    text,
    scope,
  }))
}

describe('client/games/chat-transcript/buildChatTranscript', () => {
  test('marks messages recorded by both sides as all chat, at the sender side frame', () => {
    const transcript = buildChatTranscript(
      [
        {
          side: 0,
          chat: chat(1000, [
            [100, 0, 'gl hf'],
            [205, 1, 'you too'],
          ]),
        },
        {
          side: 1,
          chat: chat(1000, [
            [104, 0, 'gl hf'],
            [200, 1, 'you too'],
          ]),
        },
      ],
      SIDES,
    )

    expect(transcript.lines).toEqual(lines([100, 0, 'gl hf', 'all'], [200, 1, 'you too', 'all']))
    expect(transcript.players.get(1)?.color).toBe('#0c48cc')
  })

  test("marks messages only the sender's side recorded as team chat", () => {
    const transcript = buildChatTranscript(
      [
        {
          side: 0,
          chat: chat(1000, [
            [100, 0, 'rush'],
            [150, 2, 'ok'],
          ]),
        },
        { side: 1, chat: chat(1000, [[120, 3, 'they rush']]) },
      ],
      SIDES,
    )

    expect(transcript.lines).toEqual(
      lines([100, 0, 'rush', 'team'], [120, 3, 'they rush', 'team'], [150, 2, 'ok', 'team']),
    )
  })

  test("leaves the scope unknown when no other side's replay was recording", () => {
    const transcript = buildChatTranscript(
      [
        {
          side: 0,
          chat: chat(1000, [
            [500, 0, 'gg'],
            [990, 2, 'ez'],
          ]),
        },
        { side: 1, chat: chat(510, [[505, 0, 'gg']]) },
      ],
      SIDES,
    )

    expect(transcript.lines).toEqual(lines([500, 0, 'gg', 'all'], [990, 2, 'ez', 'unknown']))
  })

  test('marks a message from a side with no replay as all chat when another side saw it', () => {
    const transcript = buildChatTranscript([{ side: 0, chat: chat(1000, [[100, 1, 'hi']]) }], SIDES)

    expect(transcript.lines).toEqual(lines([100, 1, 'hi', 'all']))
  })

  test("takes colors from a replay whose colors don't repeat", () => {
    // Legacy diplomacy, as seen by a1: self teal, allies yellow, enemies red.
    const presetByUserId = new Map([
      [A1, '#2cb494'],
      [A2, '#fcfc38'],
      [B1, '#f40404'],
      [B2, '#f40404'],
    ])
    const presetColors = PLAYERS.map(p => ({ ...p, color: presetByUserId.get(p.userId!) }))
    const transcript = buildChatTranscript(
      [
        { side: 0, chat: { ...chat(1000, []), players: presetColors } },
        { side: 1, chat: chat(1000, []) },
      ],
      SIDES,
    )

    expect(Array.from(transcript.players.values(), p => p.color)).toEqual(PLAYERS.map(p => p.color))
  })

  test('matches repeated identical messages in order rather than to the nearest copy', () => {
    const transcript = buildChatTranscript(
      [
        {
          side: 0,
          chat: chat(1000, [
            [100, 0, '6'],
            [106, 0, '6'],
            [112, 0, '6'],
          ]),
        },
        {
          side: 1,
          chat: chat(1000, [
            [105, 0, '6'],
            [111, 0, '6'],
            [117, 0, '6'],
          ]),
        },
      ],
      SIDES,
    )

    expect(transcript.lines).toEqual(
      lines([100, 0, '6', 'all'], [106, 0, '6', 'all'], [112, 0, '6', 'all']),
    )
  })

  test('keeps identical messages sent far apart as separate messages', () => {
    const transcript = buildChatTranscript(
      [
        {
          side: 0,
          chat: chat(5000, [
            [100, 0, 'gg'],
            [4000, 0, 'gg'],
          ]),
        },
        { side: 1, chat: chat(5000, [[4003, 0, 'gg']]) },
      ],
      SIDES,
    )

    expect(transcript.lines).toEqual(lines([100, 0, 'gg', 'team'], [4000, 0, 'gg', 'all']))
  })

  test("includes each player's leave once, interleaved with the chat", () => {
    const transcript = buildChatTranscript(
      [
        {
          side: 0,
          chat: chat(
            2000,
            [
              [100, 0, 'gg'],
              [1500, 2, 'wp'],
            ],
            [{ frame: 1200, slotId: 3, dropped: true }],
          ),
        },
        {
          side: 1,
          chat: chat(
            1300,
            [[104, 0, 'gg']],
            [
              { frame: 800, slotId: 1, dropped: false },
              { frame: 1200, slotId: 3, dropped: true },
            ],
          ),
        },
      ],
      SIDES,
    )

    expect(transcript.lines).toEqual([
      ...lines([100, 0, 'gg', 'all']),
      { kind: 'leave', frame: 800, slotId: 1, dropped: false },
      { kind: 'leave', frame: 1200, slotId: 3, dropped: true },
      ...lines([1500, 2, 'wp', 'unknown']),
    ])
  })
})
