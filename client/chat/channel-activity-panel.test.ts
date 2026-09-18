import { describe, expect, test } from 'vitest'
import { makeSbMapId } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { deriveActivityEntries } from './channel-activity-panel'

const [flash, bisu, jaedong, stork, outsider, self] = [1, 2, 3, 4, 5, 6].map(makeSbUserId)

const members = {
  active: new Set([flash, self]),
  idle: new Set([bisu]),
  offline: new Set([jaedong, stork]),
}

function stream(userId: number, viewerCount: number) {
  return {
    twitchLogin: `login${userId}`,
    title: `title${userId}`,
    viewerCount,
    user: { id: makeSbUserId(userId), name: `user${userId}` },
  }
}

function game(id: string, minutesAgo: number, teams: number[][], type = MatchmakingType.Match1v1) {
  return {
    id,
    startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    map: { id: makeSbMapId(`map-${id}`), name: `map${id}` },
    config: {
      __typename: 'GameConfigDataMatchmaking' as const,
      gameSourceExtra: { matchmakingType: type },
      teams: teams.map(team =>
        team.map(userId => ({ user: { id: makeSbUserId(userId), name: `user${userId}` } })),
      ),
    },
  }
}

describe('client/chat/channel-activity-panel', () => {
  test('keeps only members streams, most watched first, and never the viewer own', () => {
    const entries = deriveActivityEntries(
      {
        liveStreams: [
          stream(bisu, 200),
          stream(outsider, 9000),
          stream(flash, 1200),
          stream(self, 5000),
          { ...stream(jaedong, 300), user: null },
        ],
        liveGames: [],
      },
      members,
      self,
    )

    expect(entries.map(e => (e.kind === 'stream' ? e.userId : undefined))).toEqual([flash, bisu])
  })

  test('keeps games with at least one member, newest first, listing only the members', () => {
    const entries = deriveActivityEntries(
      {
        liveStreams: [],
        liveGames: [
          game('old', 40, [[stork], [outsider]]),
          game('nobody', 5, [[outsider], [outsider]]),
          game('mine', 3, [[self], [flash]]),
          game(
            'team',
            10,
            [
              [outsider, bisu],
              [jaedong, outsider],
            ],
            MatchmakingType.Match2v2,
          ),
          {
            ...game('lobby', 1, [[flash]]),
            config: { __typename: 'GameConfigDataLobby' as const },
          },
        ],
      },
      members,
      self,
    )

    expect(entries.map(e => (e.kind === 'game' ? e.gameId : undefined))).toEqual(['team', 'old'])
    expect(entries[0]).toMatchObject({
      kind: 'game',
      members: [
        { id: bisu, name: `user${bisu}` },
        { id: jaedong, name: `user${jaedong}` },
      ],
      matchmakingType: MatchmakingType.Match2v2,
      mapName: 'mapteam',
    })
  })

  test('lists streams ahead of games', () => {
    const entries = deriveActivityEntries(
      {
        liveStreams: [stream(bisu, 1)],
        liveGames: [game('g', 5, [[flash], [outsider]])],
      },
      members,
      undefined,
    )

    expect(entries.map(e => e.kind)).toEqual(['stream', 'game'])
  })
})
