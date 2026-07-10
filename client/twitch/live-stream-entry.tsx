import styled from 'styled-components'
import { ConnectedAvatar } from '../avatars/avatar'
import { FragmentType, graphql, useFragment } from '../gql'
import { bodyMedium, bodySmall, singleLine, titleSmall } from '../styles/typography'
import {
  LiveDot,
  LivePill,
  TwitchMark,
  UptimePill,
  useStreamUptime,
  ViewerCountPill,
} from './live-indicators'

/**
 * Shared fragment for the home-page "live streams" feed. Defined here (rather than duplicated in
 * each consumer) so codegen sees a single definition.
 */
export const LiveStreams_FeedFragment = graphql(/* GraphQL */ `
  fragment LiveStreams_FeedFragment on Query {
    liveStreams {
      twitchLogin
      viewerCount
      ...LiveStreams_FeedEntryFragment
    }
  }
`)

const LiveStreams_FeedEntryFragment = graphql(/* GraphQL */ `
  fragment LiveStreams_FeedEntryFragment on LiveStream {
    twitchLogin
    twitchDisplayName
    title
    viewerCount
    startedAt
    thumbnailUrl
    user {
      id
      name
    }
  }
`)

type LiveStreamFragment = ReturnType<typeof useLiveStream>

function useLiveStream(query: FragmentType<typeof LiveStreams_FeedEntryFragment>) {
  return useFragment(LiveStreams_FeedEntryFragment, query)
}

/**
 * The ShieldBattery identity leads every entry: the SB username (in amber). The Twitch handle is
 * only worth showing when it differs from the SB name.
 */
function getIdentity(stream: LiveStreamFragment) {
  const sbName = stream.user?.name ?? stream.twitchDisplayName
  const handle =
    stream.user && stream.twitchDisplayName.toLowerCase() !== stream.user.name.toLowerCase()
      ? stream.twitchDisplayName
      : undefined
  return { sbName, handle }
}

function streamUrl(login: string) {
  return `https://twitch.tv/${login}`
}

const Name = styled.span`
  ${singleLine};
  color: var(--theme-amber);
`

const Handle = styled.span`
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Thumbnail = styled.img`
  display: block;
  width: 100%;
  height: 100%;

  object-fit: cover;
  background-color: var(--theme-container-highest);
`

// --- Featured (hero) entry -------------------------------------------------------------------

const FeaturedRoot = styled.a`
  display: block;
  padding: 10px 10px 12px;

  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible {
    text-decoration: none;
    outline: none;
  }
`

const FeaturedThumb = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;

  border-radius: 6px;
  overflow: hidden;

  ${FeaturedRoot}:hover &,
  ${FeaturedRoot}:focus-visible & {
    outline: 2px solid var(--theme-live);
    outline-offset: 2px;
  }
`

const CornerTopLeft = styled.div`
  position: absolute;
  top: 8px;
  left: 8px;
`
const CornerTopRight = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
`
const CornerBottomLeft = styled.div`
  position: absolute;
  bottom: 8px;
  left: 8px;
`
const CornerBottomRight = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
`

const FeaturedMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
`

const FeaturedAvatar = styled(ConnectedAvatar)`
  width: 34px;
  height: 34px;
  flex-shrink: 0;
`

const MetaText = styled.div`
  min-width: 0;
  flex: 1;
`

const NameLine = styled.div`
  ${titleSmall};
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
`

const FeaturedTitle = styled.div`
  ${bodyMedium};
  ${singleLine};
  margin-top: 1px;
  color: var(--theme-on-surface-variant);
`

export function FeaturedLiveStreamEntry({
  query,
}: {
  query: FragmentType<typeof LiveStreams_FeedEntryFragment>
}) {
  const stream = useLiveStream(query)
  const { sbName, handle } = getIdentity(stream)

  return (
    <FeaturedRoot href={streamUrl(stream.twitchLogin)} target='_blank' rel='noopener'>
      <FeaturedThumb>
        <Thumbnail src={stream.thumbnailUrl} alt='' loading='lazy' />
        <CornerTopLeft>
          <LivePill />
        </CornerTopLeft>
        <CornerTopRight>
          <ViewerCountPill count={stream.viewerCount} />
        </CornerTopRight>
        <CornerBottomLeft>
          <UptimePill startedAt={stream.startedAt} />
        </CornerBottomLeft>
        <CornerBottomRight>
          <TwitchMark />
        </CornerBottomRight>
      </FeaturedThumb>
      <FeaturedMeta>
        {stream.user ? <FeaturedAvatar userId={stream.user.id} /> : null}
        <MetaText>
          <NameLine>
            <Name>{sbName}</Name>
            {handle ? <Handle>@{handle}</Handle> : null}
          </NameLine>
          <FeaturedTitle>{stream.title}</FeaturedTitle>
        </MetaText>
      </FeaturedMeta>
    </FeaturedRoot>
  )
}

// --- Compact row entry -----------------------------------------------------------------------

const RowRoot = styled.a`
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 12px;

  color: inherit;
  text-decoration: none;
  contain: content;

  &:link,
  &:visited {
    color: inherit;
  }

  &:hover,
  &:focus-visible {
    background-color: var(--theme-container-high);
    text-decoration: none;
    outline: none;
  }
`

const RowThumb = styled.div`
  position: relative;
  width: 108px;
  height: 61px;
  flex-shrink: 0;

  border-radius: 4px;
  overflow: hidden;
`

const RowViewerCorner = styled.div`
  position: absolute;
  bottom: 5px;
  right: 5px;
`

const RowInfo = styled.div`
  min-width: 0;
  flex: 1;
`

const RowNameLine = styled.div`
  ${titleSmall};
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`

const RowTitle = styled.div`
  ${bodyMedium};
  ${singleLine};
  margin-top: 2px;
`

const RowMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  margin-top: 2px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

export function LiveStreamEntry({
  query,
}: {
  query: FragmentType<typeof LiveStreams_FeedEntryFragment>
}) {
  const stream = useLiveStream(query)
  const { sbName, handle } = getIdentity(stream)
  const uptime = useStreamUptime(stream.startedAt)

  return (
    <RowRoot href={streamUrl(stream.twitchLogin)} target='_blank' rel='noopener'>
      <RowThumb>
        <Thumbnail src={stream.thumbnailUrl} alt='' width={108} height={61} loading='lazy' />
        <RowViewerCorner>
          <ViewerCountPill count={stream.viewerCount} />
        </RowViewerCorner>
      </RowThumb>
      <RowInfo>
        <RowNameLine>
          <LiveDot $size={7} />
          <Name>{sbName}</Name>
          {handle ? <Handle>@{handle}</Handle> : null}
        </RowNameLine>
        <RowTitle>{stream.title}</RowTitle>
        <RowMeta>{uptime}</RowMeta>
      </RowInfo>
    </RowRoot>
  )
}
