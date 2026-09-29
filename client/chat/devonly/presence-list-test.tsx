import styled from 'styled-components'
import { makeSbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { bodyMedium, titleLarge } from '../../styles/typography'
import { LiveUsersContext } from '../../twitch/live-state'
import { GameActivityEntry, GameActivityPlayer } from '../channel-activity'
import { UserList } from '../channel-user-list'

/** Builds a gradient placeholder image as a data URI (no remote images in dev). */
function placeholderImage(from: string, to: string, width = 320, height = 180) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const now = Date.now()

const streams = [
  {
    id: 'stream:1',
    twitchLogin: 'flash',
    twitchDisplayName: 'Flash',
    title: 'ASL practice, ladder grind to A rank — come say hi',
    viewerCount: 1240,
    startedAt: new Date(now - 94 * 60_000).toISOString(),
    thumbnailUrl: placeholderImage('#123a86', '#0f2033'),
    user: { id: makeSbUserId(1), name: 'Flash' },
  },
  {
    id: 'stream:2',
    twitchLogin: 'bisu_official',
    twitchDisplayName: 'Bisu',
    title:
      'fastest money games with viewers all night, !discord for the lobby password and !bracket for the cup',
    viewerCount: 870,
    startedAt: new Date(now - 47 * 60_000).toISOString(),
    thumbnailUrl: placeholderImage('#5b3aa8', '#14202e'),
    user: { id: makeSbUserId(2), name: 'Bisu' },
  },
  {
    id: 'stream:3',
    twitchLogin: 'jaedong',
    twitchDisplayName: 'Jaedong',
    title: 'ZvT lessons — reviewing your replays',
    viewerCount: 512,
    startedAt: new Date(now - 130 * 60_000).toISOString(),
    thumbnailUrl: placeholderImage('#2a4a2f', '#14202e'),
    user: { id: makeSbUserId(3), name: 'Jaedong' },
  },
  {
    id: 'stream:4',
    twitchLogin: 'stork',
    twitchDisplayName: 'Stork',
    title: 'PvZ build orders',
    viewerCount: 204,
    startedAt: new Date(now - 18 * 60_000).toISOString(),
    thumbnailUrl: placeholderImage('#4a2c2c', '#14202e'),
    user: { id: makeSbUserId(4), name: 'Stork' },
  },
]

function mockMap(name: string, from: string, to: string): GameActivityEntry['map'] {
  const url = placeholderImage(from, to, 256, 256)
  return {
    id: makeSbMapId(name.toLowerCase().replace(/\s+/g, '-')),
    name,
    mapFile: {
      id: `file-${name}`,
      image256Url: url,
      image512Url: url,
      image1024Url: url,
      image2048Url: url,
      width: 256,
      height: 256,
    },
  }
}

function player(id: number, race: GameActivityPlayer['race']): GameActivityPlayer {
  return { userId: makeSbUserId(id), name: `Player ${id}`, race }
}

const games: GameActivityEntry[] = [
  {
    gameId: '11111111-1111-4111-8111-111111111111',
    members: [makeSbUserId(7)],
    teams: [[player(7, 'z'), player(101, 'p')]],
    matchmakingType: MatchmakingType.Match1v1,
    startTime: now - 7 * 60_000,
    map: mockMap('Fighting Spirit', '#3b4d2c', '#1a2418'),
  },
  {
    gameId: '22222222-2222-4222-8222-222222222222',
    members: [makeSbUserId(4), makeSbUserId(5)],
    teams: [
      [player(4, 't'), player(102, 'p')],
      [player(5, 'z'), player(103, 'r')],
    ],
    matchmakingType: MatchmakingType.Match2v2,
    startTime: now - 23 * 60_000,
    map: mockMap('Neo Sylphid', '#4a3a2c', '#241c14'),
  },
  {
    gameId: '33333333-3333-4333-8333-333333333333',
    members: [makeSbUserId(6)],
    teams: [[player(6, 'p'), player(104, 't')]],
    matchmakingType: MatchmakingType.Match1v1Fastest,
    startTime: now - 71 * 60_000,
    map: mockMap('Big Game Hunters', '#2c4a4a', '#14201f'),
  },
  {
    gameId: '44444444-4444-4444-8444-444444444444',
    members: [makeSbUserId(8), makeSbUserId(9), makeSbUserId(10), makeSbUserId(11)],
    teams: [
      [player(8, 'z'), player(9, 'p')],
      [player(10, 't'), player(11, 'z')],
    ],
    matchmakingType: MatchmakingType.Match2v2Hunters,
    startTime: now - 12 * 60_000,
    map: mockMap('Circuit Breaker', '#3a2c4a', '#1c1424'),
  },
]

const roster = {
  active: [1, 2, 3, 4, 5].map(makeSbUserId),
  offline: [6, 7, 8, 9, 10, 11, 12].map(makeSbUserId),
}

const liveUsers: ReadonlySet<SbUserId> = new Set(streams.map(s => s.user.id))

type MockStream = (typeof streams)[number]

const Root = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionTitle = styled.div`
  ${titleLarge};
  margin-top: 16px;
`

const Note = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Columns = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 32px;
`

const MemberColumn = styled.div<{ $height: number }>`
  height: ${props => props.$height}px;
  flex-shrink: 0;

  display: flex;
`

function Column({
  height,
  streams,
  games,
}: {
  height: number
  streams: ReadonlyArray<MockStream>
  games: ReadonlyArray<GameActivityEntry>
}) {
  return (
    <MemberColumn $height={height}>
      <UserList active={roster.active} offline={roster.offline} streams={streams} games={games} />
    </MemberColumn>
  )
}

export function PresenceListTest() {
  return (
    <LiveUsersContext.Provider value={liveUsers}>
      <Root>
        <Note>
          Each column is the channel page's 256px user list. Live streams and games are sections
          above the roster; game rows expand to show everyone playing. Thumbnails are gradient
          placeholders. Avatars and roster names resolve through the store.
        </Note>

        <SectionTitle>No activity, tall and short</SectionTitle>
        <Columns>
          <Column height={800} streams={[]} games={[]} />
          <Column height={560} streams={[]} games={[]} />
        </Columns>

        <SectionTitle>One stream and one game</SectionTitle>
        <Columns>
          <Column height={800} streams={streams.slice(0, 1)} games={games.slice(0, 1)} />
        </Columns>

        <SectionTitle>Four streams and four games, tall and short</SectionTitle>
        <Columns>
          <Column height={800} streams={streams} games={games} />
          <Column height={560} streams={streams} games={games} />
        </Columns>

        <SectionTitle>Games only</SectionTitle>
        <Columns>
          <Column height={800} streams={[]} games={games} />
        </Columns>

        <SectionTitle>Streams only</SectionTitle>
        <Columns>
          <Column height={800} streams={streams} games={[]} />
        </Columns>
      </Root>
    </LiveUsersContext.Provider>
  )
}
