import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { graphql, useFragment } from '../gql'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, headlineMedium } from '../styles/typography'
import { FeaturedLiveStreamEntry, LiveStreams_FeedFragment } from './live-stream-entry'

const LiveStreamsPageQuery = graphql(/* GraphQL */ `
  query LiveStreamsPage {
    ...LiveStreams_FeedFragment
  }
`)

const Root = styled.div`
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
`

const Content = styled(CenteredContentContainer)`
  padding-block: 24px 48px;
`

const PageHeader = styled.div`
  ${headlineMedium};
  margin-bottom: 24px;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
`

const EmptyText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

export function LiveStreamsPage() {
  const { t } = useTranslation()
  const [{ data }] = useQuery({ query: LiveStreamsPageQuery, context: { ttl: 10 * 1000 } })
  const { liveStreams } = useFragment(LiveStreams_FeedFragment, data) ?? { liveStreams: [] }
  const sorted = [...liveStreams].sort((a, b) => b.viewerCount - a.viewerCount)

  return (
    <Root>
      <Content>
        <PageHeader>{t('twitch.liveStreams.pageTitle', 'Live streams')}</PageHeader>
        {sorted.length > 0 ? (
          <Grid>
            {sorted.map(stream => (
              <FeaturedLiveStreamEntry key={stream.twitchLogin} query={stream} />
            ))}
          </Grid>
        ) : (
          <EmptyText>
            {t('twitch.liveStreams.empty', 'No one is streaming StarCraft right now.')}
          </EmptyText>
        )}
      </Content>
    </Root>
  )
}
