import { describe, expect, test } from 'vitest'
import { makeSbMapId } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { deriveActivityEntries } from './channel-activity-panel'

const [flash, bisu, jaedong, stork, outsider, self] = [1, 2, 3, 4, 5, 6].map(makeSbUserId)

const members = {
  active: new Set([flash, self]),
  offline: new Set([bisu, jaedong, stork]),
}

function stream(userId: number, viewerCount: number) {
  return {
    id: `stream:${userId}`,
    twitchLogin: `login${userId}`,
    twitchDisplayName: `user${userId}`,
    title: `title${userId}`,
    viewerCount,
    startedAt: new Date().toISOString(),
    thumbnailUrl: '',
    user: { id: makeSbUserId(userId), name: `user${userId}` },
  }
}

function mapFile(id: string) {
  return {
    id,
    image256Url: '',
    image512Url: '',
    image1024Url: '',
    image2048Url: '',
    width: 256,
    height: 256,
  }
}

function game(id: string, minutesAgo: number, teams: number[][], type = MatchmakingType.Match1v1) {
  return {
    id,
    startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    map: { id: makeSbMapId(`map-${id}`), name: `map${id}`, mapFile: mapFile(`file-${id}`) },
    config: {
      __typename: 'GameConfigDataMatchmaking' as const,
      gameSourceExtra: { matchmakingType: type },
      teams: teams.map(team => team.map(userId => ({ user: { id: makeSbUserId(userId) } }))),
    },
  }
}

describe('client/chat/channel-activity-panel', () => {
  test('keeps only members streams, most watched first, and never the viewer own', () => {
    const { streams, games } = deriveActivityEntries(
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

    expect(streams.map(s => s.user?.id)).toEqual([flash, bisu])
    expect(games).toEqual([])
  })

  test('keeps games with at least one member, newest first, listing only the members', () => {
    const { streams, games } = deriveActivityEntries(
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

    expect(streams).toEqual([])
    expect(games.map(g => g.gameId)).toEqual(['team', 'old'])
    expect(games[0]).toMatchObject({
      members: [bisu, jaedong],
      matchmakingType: MatchmakingType.Match2v2,
      map: { name: 'mapteam' },
    })
  })

  test('lists streams and games as separate groups', () => {
    const { streams, games } = deriveActivityEntries(
      {
        liveStreams: [stream(bisu, 1)],
        liveGames: [game('g', 5, [[flash], [outsider]])],
      },
      members,
      undefined,
    )

    expect(streams).toHaveLength(1)
    expect(games).toHaveLength(1)
  })
})
