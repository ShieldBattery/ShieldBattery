import styled from 'styled-components'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { bodyMedium, titleLarge } from '../../styles/typography'
import { ActivityEntry, ActivityPanel } from '../channel-activity-panel'
import { UserList } from '../channel-user-list'

const now = Date.now()

const entries: ActivityEntry[] = [
  {
    kind: 'stream',
    userId: makeSbUserId(1),
    name: 'Flash',
    twitchLogin: 'flash',
    title: 'ASL practice, ladder grind to A rank — come say hi',
    viewerCount: 1240,
  },
  {
    kind: 'stream',
    userId: makeSbUserId(2),
    name: 'Bisu',
    twitchLogin: 'bisu_official',
    title: 'fastest money games with viewers',
    viewerCount: 870,
  },
  {
    kind: 'game',
    gameId: '11111111-1111-4111-8111-111111111111',
    members: [{ id: makeSbUserId(3), name: 'Jaedong' }],
    matchmakingType: MatchmakingType.Match1v1,
    mapName: 'Fighting Spirit',
    startTime: now - 7 * 60_000,
  },
  {
    kind: 'game',
    gameId: '22222222-2222-4222-8222-222222222222',
    members: [
      { id: makeSbUserId(4), name: 'SoulKey' },
      { id: makeSbUserId(5), name: 'Snow' },
    ],
    matchmakingType: MatchmakingType.Match2v2,
    mapName: 'Neo Sylphid',
    startTime: now - 23 * 60_000,
  },
  {
    kind: 'game',
    gameId: '33333333-3333-4333-8333-333333333333',
    members: [{ id: makeSbUserId(6), name: 'Stork' }],
    matchmakingType: MatchmakingType.Match1v1Fastest,
    mapName: 'Big Game Hunters',
    startTime: now - 71 * 60_000,
  },
]

const roster = {
  active: [1, 2, 3].map(makeSbUserId),
  idle: [4, 5].map(makeSbUserId),
  offline: [6, 7, 8, 9, 10, 11, 12].map(makeSbUserId),
}

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

// Mirrors the channel page's member column: a fixed 256px width, the panel on top, the user list
// filling whatever height remains.
const MemberColumn = styled.div<{ $height: number }>`
  width: 256px;
  height: ${props => props.$height}px;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const FillingUserList = styled(UserList)`
  flex: 1 1 0;
  min-height: 0;
`

function Column({ height, entries }: { height: number; entries: ReadonlyArray<ActivityEntry> }) {
  return (
    <MemberColumn $height={height}>
      <ActivityPanel entries={entries} />
      <FillingUserList active={roster.active} idle={roster.idle} offline={roster.offline} />
    </MemberColumn>
  )
}

export function ActivityPanelTest() {
  return (
    <Root>
      <Note>
        Each column is the channel page's 256px member column at a given height. Avatars and roster
        names resolve through the store, so they show as loading unless those user ids exist on the
        dev server.
      </Note>

      <SectionTitle>No entries (panel hidden), tall and short</SectionTitle>
      <Columns>
        <Column height={640} entries={[]} />
        <Column height={400} entries={[]} />
      </Columns>

      <SectionTitle>Two entries (one stream, one game), tall and short</SectionTitle>
      <Columns>
        <Column height={640} entries={[entries[0], entries[2]]} />
        <Column height={400} entries={[entries[0], entries[2]]} />
      </Columns>

      <SectionTitle>Three entries (at the cap, no control)</SectionTitle>
      <Columns>
        <Column height={640} entries={entries.slice(0, 3)} />
      </Columns>

      <SectionTitle>Five entries (capped with "Show 2 more"), tall and short</SectionTitle>
      <Columns>
        <Column height={640} entries={entries} />
        <Column height={400} entries={entries} />
      </Columns>
    </Root>
  )
}
