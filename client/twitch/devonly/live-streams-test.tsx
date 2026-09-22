import styled from 'styled-components'
import { Avatar } from '../../avatars/avatar'
import { LiveStreamPlatform } from '../../gql/graphql'
import { LiveStreamsFeed } from '../../home/home'
import { titleLarge, titleSmall } from '../../styles/typography'
import { ProfileLiveBanner } from '../../users/user-profile'
import {
  LiveDot,
  LiveLabel,
  LivePill,
  LiveWatchRow,
  PlatformMark,
  UptimePill,
  ViewerCountPill,
} from '../live-indicators'
import { FeaturedLiveStreamEntry } from '../live-stream-entry'
import { LiveStreamsGrid } from '../live-streams-page'

/** Builds a gradient placeholder thumbnail as a data URI (no remote images in dev). */
function thumb(from: string, to: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs><rect width="320" height="180" fill="url(#g)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const now = Date.now()
const mockStreams = [
  {
    id: 'stream:twitch:1',
    platform: LiveStreamPlatform.Twitch,
    displayName: 'Flash',
    url: 'https://twitch.tv/flash',
    title: 'ASL practice, ladder grind to A rank',
    gameName: 'StarCraft: Remastered',
    viewerCount: 1240,
    startedAt: new Date(now - 94 * 60_000).toISOString(),
    thumbnailUrl: thumb('#123a86', '#0f2033'),
    user: { id: 1, name: 'Flash' },
  },
  {
    id: 'stream:youtube:2',
    platform: LiveStreamPlatform.Youtube,
    displayName: 'Bisu',
    url: 'https://www.youtube.com/watch?v=bisu-fastest',
    title: 'fastest money games with viewers',
    // YouTube exposes no category for a broadcast.
    gameName: null,
    viewerCount: 870,
    startedAt: new Date(now - 47 * 60_000).toISOString(),
    thumbnailUrl: thumb('#5b3aa8', '#14202e'),
    user: { id: 2, name: 'Bisu' },
  },
  {
    id: 'stream:twitch:3',
    platform: LiveStreamPlatform.Twitch,
    displayName: 'Jaedong',
    url: 'https://twitch.tv/jaedong',
    title: 'ZvT lessons — reviewing your replays',
    gameName: 'StarCraft: Remastered',
    viewerCount: 512,
    startedAt: new Date(now - 130 * 60_000).toISOString(),
    thumbnailUrl: thumb('#2a4a2f', '#14202e'),
    user: { id: 3, name: 'Jaedong' },
  },
  {
    id: 'stream:youtube:4',
    platform: LiveStreamPlatform.Youtube,
    // The platform's own display name differs from the SB name, to exercise the "@handle" line.
    displayName: 'BW_SoulKey',
    url: 'https://www.youtube.com/watch?v=soulkey-bgh',
    title: 'chill BGH into ladder later',
    gameName: null,
    // YouTube hides the concurrent viewer count on some broadcasts.
    viewerCount: null,
    startedAt: new Date(now - 18 * 60_000).toISOString(),
    thumbnailUrl: thumb('#7a5a1e', '#14202e'),
    user: { id: 4, name: 'SoulKey' },
  },
]

// The entry/feed components read masked fragment types; at runtime `useFragment` is the identity
// function, so a flat mock carrying every selected field renders correctly through both levels.
const mockFeed = { liveStreams: mockStreams } as unknown as Parameters<
  typeof LiveStreamsFeed
>[0]['query']

const mockEntries = mockStreams.map(
  s => s as unknown as Parameters<typeof FeaturedLiveStreamEntry>[0]['query'],
)

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

const PrimitiveRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 16px;

  background-color: var(--theme-container-lowest);
  border-radius: 8px;
`

// Mimics the width of the home page's right-hand sidebar, where the feed actually lives.
const Sidebar = styled.div`
  width: 360px;
  max-width: 100%;
`

// Mimics the width of the user profile hover card (Popover), where the watch row appears.
const WatchRowArea = styled.div`
  width: 288px;
  max-width: 100%;
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  background-color: var(--theme-container-low);
  border-radius: 8px;
`

export function LiveStreamsTest() {
  return (
    <Root>
      <SectionTitle>Live primitives</SectionTitle>
      <PrimitiveRow>
        <LiveDot />
        <LivePill />
        <LiveLabel />
        <ViewerCountPill count={1240} />
        <UptimePill startedAt={mockStreams[0].startedAt} />
        <PlatformMark platform={LiveStreamPlatform.Twitch} />
        <PlatformMark platform={LiveStreamPlatform.Youtube} />
      </PrimitiveRow>

      <SectionTitle>Home feed (featured hero + compact rows)</SectionTitle>
      <Sidebar>
        <LiveStreamsFeed query={mockFeed} />
      </Sidebar>

      <SectionTitle>Profile live banners (with and without category/viewers)</SectionTitle>
      <ProfileLiveBanner
        url='https://twitch.tv/flash'
        platform={LiveStreamPlatform.Twitch}
        title='ASL practice, ladder grind to A rank — come say hi and rank with me'
        gameName='StarCraft: Remastered'
        viewerCount={1240}
        thumbnailUrl={thumb('#123a86', '#0f2033')}
        startedAt={mockStreams[0].startedAt}
      />
      <ProfileLiveBanner
        url='https://www.youtube.com/watch?v=soulkey-bgh'
        platform={LiveStreamPlatform.Youtube}
        title='chill BGH into ladder later'
        gameName={null}
        viewerCount={null}
        thumbnailUrl={thumb('#7a5a1e', '#14202e')}
        startedAt={mockStreams[3].startedAt}
      />

      <SectionTitle>Profile hover-card watch rows</SectionTitle>
      <WatchRowArea>
        <LiveWatchRow
          url='https://twitch.tv/flash'
          title='ASL practice, ladder grind to A rank'
          viewerCount={1240}
        />
        <LiveWatchRow
          url='https://www.youtube.com/watch?v=soulkey-bgh'
          title='chill BGH into ladder later'
          viewerCount={null}
        />
      </WatchRowArea>

      <SectionTitle>Friends list (live treatment)</SectionTitle>
      <FriendsArea>
        <FriendRow user='Bisu' isLive={true} />
        <FriendRow user='SnOw' isLive={false} />
      </FriendsArea>

      <SectionTitle>Small avatar (live) — ring + tag at lobby-slot size</SectionTitle>
      <LobbySlotRow>
        <LobbySlotAvatar user='Bisu' live={true} liveTitle='Streaming live' />
        <span>Bisu</span>
      </LobbySlotRow>

      <SectionTitle>Live page grid</SectionTitle>
      <LiveStreamsGrid>
        {mockEntries.map((query, i) => (
          <FeaturedLiveStreamEntry key={i} query={query} />
        ))}
      </LiveStreamsGrid>
    </Root>
  )
}

const LobbySlotRow = styled.div`
  ${titleSmall};
  display: flex;
  align-items: center;
  gap: 16px;
  height: 48px;
`

const LobbySlotAvatar = styled(Avatar)`
  width: 24px;
  height: 24px;
`

const FriendsArea = styled.div`
  width: 288px;
  max-width: 100%;
  padding: 8px;

  background-color: var(--theme-container-lowest);
  border-radius: 8px;
`

const FriendRowRoot = styled.div`
  ${titleSmall};
  height: 44px;
  padding: 4px 8px;

  display: flex;
  align-items: center;
`

const FriendAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;
  margin: 2px 16px 2px 0;
`

const FriendRowName = styled.div`
  flex-grow: 1;
`

// Standalone reproduction of a friends-list row (the real FriendEntry is Redux + overlay wired).
function FriendRow({ user, isLive }: { user: string; isLive: boolean }) {
  return (
    <FriendRowRoot>
      <FriendAvatar user={user} live={isLive} liveTitle='Streaming live' />
      <FriendRowName>{user}</FriendRowName>
      {isLive ? <LiveLabel /> : null}
    </FriendRowRoot>
  )
}
