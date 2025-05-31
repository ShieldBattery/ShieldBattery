import React, { Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { FragmentType, graphql, useFragment } from '../gql'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-color.svg'
import PatreonIcon from '../icons/brands/patreon.svg'
import { MaterialIcon } from '../icons/material/material-icon'
import { LeagueHomeFeed } from '../leagues/league-home-feed'
import { LiveGamesHomeFeed } from '../matchmaking/live-games-home-feed'
import { TextButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { StaticNewsFeed } from '../news/static-news-feed'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { singleLine, titleLarge, titleSmall } from '../styles/typography'
import { BottomLinks } from './bottom-links'
import { useLastSeenUrgentMessage } from './last-seen-urgent-message'
import { SplashContent } from './splash'

const Root = styled.div`
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
`

const GridLayout = styled(CenteredContentContainer)`
  height: auto;
  padding-top: 24px;

  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: 1fr auto;
  gap: 40px;

  @media (max-width: 940px) {
    column-gap: 24px;
  }

  @media (max-width: 860px) {
    grid-template-columns: repeat(3, 1fr);
  }
`

const LeftSection = styled.div`
  grid-column: span 3;
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const RightSection = styled.div`
  grid-column: span 2;
  display: flex;
  flex-direction: column;
  gap: 32px;

  @media (max-width: 860px) {
    display: none;
  }
`
const SupportSection = styled.div`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  min-height: 56px;
  padding-inline: 16px 4px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  border-radius: 4px;
`

const SupportText = styled.div`
  ${titleSmall};
  padding-block: 16px;
`

const SupportIcons = styled.div`
  display: flex;
  align-items: center;

  & a {
    &,
    &:link,
    &:visited {
      width: 56px;
      height: 48px;

      display: flex;
      align-items: center;
      justify-content: center;

      border-radius: 8px;
      color: var(--theme-on-surface);
      text-align: center;
    }

    &:hover,
    &:active {
      background-color: var(--theme-container-low);
    }
  }
`

const StyledGithubIcon = styled(GithubIcon)`
  height: 32px;
`

const StyledKofiIcon = styled(KofiIcon)`
  height: 32px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 32px;
  color: #fff;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  ${titleLarge};
  ${singleLine};
`

const BottomLinksArea = styled.div`
  grid-column: 1 / -1;
`

const HomeQuery = graphql(/* GraphQL */ `
  query HomePageContent {
    urgentMessage {
      ...UrgentMessage_HomeDisplayFragment
    }

    ...LiveGames_HomeFeedFragment
    ...Leagues_HomeFeedFragment
  }
`)

export function Home() {
  const { t } = useTranslation()
  // TODO(tec27): Once this isn't a static news feed we should probably check for errors on loading
  // this and show a message if it fails (currently it just hides the non-static parts)
  const [{ data }] = useQuery({ query: HomeQuery, context: { ttl: 10 * 1000 } })

  const hasSplash = !IS_ELECTRON

  return (
    <>
      <Root>
        <Suspense fallback={<LoadingDotsArea />}>
          {hasSplash ? <SplashContent /> : null}
          <GridLayout>
            <LeftSection>
              <UrgentMessageView urgentMessage={data?.urgentMessage ?? undefined} />
              <Section>
                <SectionTitle data-test='latest-news-title'>
                  {t('home.latestNewsTitle', 'Latest news')}
                </SectionTitle>
                <StaticNewsFeed />
              </Section>
            </LeftSection>
            <RightSection>
              <SupportSection>
                <SupportText>{t('home.supportTitle', 'Support the project')}</SupportText>
                <SupportIcons>
                  <Tooltip text={'GitHub Sponsors'} position='bottom' tabIndex={-1}>
                    <a
                      href='https://github.com/sponsors/ShieldBattery'
                      target='_blank'
                      rel='noopener'>
                      <StyledGithubIcon />
                    </a>
                  </Tooltip>
                  <Tooltip text={'Patreon'} position='bottom' tabIndex={-1}>
                    <a href='https://patreon.com/tec27' target='_blank' rel='noopener'>
                      <StyledPatreonIcon />
                    </a>
                  </Tooltip>
                  <Tooltip text={'Ko-fi'} position='bottom' tabIndex={-1}>
                    <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener'>
                      <StyledKofiIcon />
                    </a>
                  </Tooltip>
                </SupportIcons>
              </SupportSection>
              <Section>
                <LiveGamesHomeFeed
                  query={data}
                  title={<SectionTitle>{t('games.liveGames.title', 'Live games')}</SectionTitle>}
                />
              </Section>
              <Section>
                <LeagueHomeFeed
                  query={data}
                  title={<SectionTitle>{t('leagues.activity.title', 'Leagues')}</SectionTitle>}
                />
              </Section>
            </RightSection>
            <BottomLinksArea>
              <BottomLinks />
            </BottomLinksArea>
          </GridLayout>
        </Suspense>
      </Root>
    </>
  )
}

const UrgentMessageRoot = styled.div`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
  height: 56px;
  padding-inline: 16px 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 4px;
  color: var(--theme-amber);
`

const UrgentMessageSpaceHolder = styled.div`
  height: 56px;
`

const UrgentMessageText = styled.div`
  ${singleLine};
  ${titleSmall};
  flex-grow: 1;
  flex-shrink: 1;
`

const UrgentMessage_HomeDisplayFragment = graphql(/* GraphQL */ `
  fragment UrgentMessage_HomeDisplayFragment on UrgentMessage {
    id
    title
    message
  }
`)

function UrgentMessageView(props: {
  urgentMessage?: FragmentType<typeof UrgentMessage_HomeDisplayFragment>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const urgentMessage = useFragment(UrgentMessage_HomeDisplayFragment, props.urgentMessage)
  const [lastSeenId, markSeen] = useLastSeenUrgentMessage()

  useEffect(() => {
    if (urgentMessage && urgentMessage.id !== lastSeenId) {
      markSeen(urgentMessage.id)
    }
  }, [lastSeenId, markSeen, urgentMessage])

  return urgentMessage ? (
    <UrgentMessageRoot>
      <MaterialIcon icon='priority_high' />
      <UrgentMessageText>{urgentMessage.title}</UrgentMessageText>
      <TextButton
        label={t('common.actions.read', 'Read')}
        onClick={() => {
          dispatch(
            openDialog({
              type: DialogType.Markdown,
              initData: { title: urgentMessage.title, markdownContent: urgentMessage.message },
            }),
          )
        }}
      />
    </UrgentMessageRoot>
  ) : (
    <UrgentMessageSpaceHolder />
  )
}
