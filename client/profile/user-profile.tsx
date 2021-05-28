import React, { useCallback, useMemo } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { RaceChar } from '../../common/races'
import Avatar from '../avatars/avatar'
import GithubIcon from '../icons/brands/github.svg'
import KofiIcon from '../icons/brands/kofi-lockup.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import { RaceIcon } from '../lobbies/race-icon'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { TabItem, Tabs } from '../material/tabs'
import { push } from '../navigation/routing'
import { urlPath } from '../network/urls'
import {
  amberA400,
  background700,
  backgroundSaturatedDark,
  backgroundSaturatedLight,
  blue400,
  colorNegative,
  colorPositive,
  colorTextFaint,
  colorTextInvert,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import {
  Body1,
  Body2,
  body2,
  caption,
  headline3,
  Headline5,
  headline6,
  overline,
  singleLine,
  Subtitle1,
  subtitle1,
  Subtitle2,
} from '../styles/typography'
import { timeAgo } from '../time/time-ago'

const Container = styled.div`
  max-width: 960px;
  /* 18px + 6px from tab = 24px at top, 12px + 24px from tab = 36px from left */
  padding: 18px 12px 24px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
`

export enum UserProfileSubPage {
  Summary = 'summary',
  Stats = 'stats',
  MatchHistory = 'match-history',
  Seasons = 'seasons',
}

export interface UserProfilePageProps {
  username: string
  subPage?: UserProfileSubPage
  onTabChange?: (tab: UserProfileSubPage) => void
}

export function UserProfilePage({
  username,
  subPage = UserProfileSubPage.Summary,
  onTabChange,
}: UserProfilePageProps) {
  const handleTabChange = useCallback(
    (tab: UserProfileSubPage) => {
      if (onTabChange) {
        onTabChange(tab)
      } else {
        push(urlPath`/users/${username}/${tab}`)
      }
    },
    [onTabChange, username],
  )

  let content: React.ReactNode
  switch (subPage) {
    case UserProfileSubPage.Summary:
      content = <SummaryPage username={username} />
      break

    case UserProfileSubPage.Stats:
    case UserProfileSubPage.MatchHistory:
    case UserProfileSubPage.Seasons:
      content = <ComingSoonPage />
      break

    default:
      content = assertUnreachable(subPage)
  }

  return (
    <Container>
      <TabArea>
        <Tabs activeTab={subPage} onChange={handleTabChange}>
          <TabItem value={UserProfileSubPage.Summary} text='Summary' />
          <TabItem value={UserProfileSubPage.Stats} text='Stats' />
          <TabItem value={UserProfileSubPage.MatchHistory} text='Match history' />
          <TabItem value={UserProfileSubPage.Seasons} text='Seasons' />
        </Tabs>
      </TabArea>

      {content}
    </Container>
  )
}

const TopSection = styled.div`
  height: 100px;
  width: 100%;
  /* 34px + 6px from tab = 40px */
  margin-top: 34px;
  margin-bottom: 48px;
  padding: 0 24px;

  display: flex;
  align-items: center;
`

const AvatarCircle = styled.div`
  width: 100px;
  height: 100px;
  position: relative;

  background-color: ${backgroundSaturatedDark};
  border: 12px solid ${backgroundSaturatedLight};
  border-radius: 50%;
`

const StyledAvatar = styled(Avatar)`
  position: absolute;
  width: 56px;
  height: 56px;
  top: calc(50% - 28px);
  left: calc(50% - 28px);
`

const UsernameAndTitle = styled.div`
  flex-grow: 1;
  margin-left: 24px;
`

const Username = styled.div`
  ${headline3};
  ${singleLine};
  color: ${amberA400};
`

const RankInfo = styled.div`
  display: flex;
  flex-direction: column;
`

const RankInfoEntry = styled.div`
  display: flex;
  align-items: center;

  & + & {
    margin-top: 12px;
  }
`

const RankLabel = styled.div`
  ${overline};
  ${singleLine};

  width: 112px;
  margin-right: 12px;
  display: inline-block;

  color: ${colorTextSecondary};
  line-height: 28px;
  text-align: right;
`

const RankValue = styled.div<{ $background: 'accent' | 'primary' }>`
  ${subtitle1};
  height: 28px;
  padding: 0 12px;
  display: inline-block;

  background-color: ${props => (props.$background === 'accent' ? amberA400 : blue400)};
  border-radius: 4px;
  color: ${props => (props.$background === 'accent' ? colorTextInvert : colorTextPrimary)};
  line-height: 28px;
`

const SectionOverline = styled.div`
  ${overline};
  ${singleLine};
  color: ${colorTextFaint};
  margin: 12px 24px;
`

const TotalGamesSection = styled.div`
  padding: 0 24px;
  margin-bottom: 48px;

  display: flex;
  align-items: center;
`

const TotalGamesSpacer = styled.div`
  width: 8px;
  height: 1px;
  flex-grow: 1;
`

const EmptyListText = styled.div`
  ${subtitle1};
  margin: 0 24px;
  color: ${colorTextFaint};
`

function SummaryPage({ username }: { username: string }) {
  const title = 'Biggus Fannius'
  const mmr = 1698
  const rank = 1

  return (
    <>
      <TopSection>
        <AvatarCircle>
          <StyledAvatar username={username} />
        </AvatarCircle>
        <UsernameAndTitle>
          <Username>{username}</Username>
          <Subtitle2>{title}</Subtitle2>
        </UsernameAndTitle>
        <RankInfo>
          <RankInfoEntry>
            <RankLabel>Current MMR</RankLabel>
            <RankValue $background='accent'>{mmr}</RankValue>
          </RankInfoEntry>
          <RankInfoEntry>
            <RankLabel>Current Rank</RankLabel>
            <RankValue $background='primary'>{rank}</RankValue>
          </RankInfoEntry>
        </RankInfo>
      </TopSection>

      <SectionOverline>Total games</SectionOverline>
      <TotalGamesSection>
        <TotalGamesEntry race='t' wins={13925} losses={10664} />
        <TotalGamesSpacer />
        <TotalGamesEntry race='z' wins={2185} losses={3688} />
        <TotalGamesSpacer />
        <TotalGamesEntry race='p' wins={261} losses={83} />
      </TotalGamesSection>

      <SectionOverline>Latest games</SectionOverline>
      <MatchHistory />

      <SectionOverline>Achievements</SectionOverline>
      <EmptyListText>Nothing to see here</EmptyListText>
    </>
  )
}

const ComingSoonRoot = styled.div`
  /* 34px + 6px from tab = 40px */
  margin-top: 34px;
  padding: 0 24px;
`

const FundingSection = styled.div`
  margin-top: 48px;
`

const SupportLinks = styled.div`
  display: flex;
  align-items: flex-start;

  margin-top: 8px;
  /** Offset for the inner padding of the first item */
  margin-left: -16px;

  a,
  a:link,
  a:visited {
    height: 48px;
    display: flex;
    align-items: center;
    color: ${colorTextSecondary};
    padding-left: 16px;
    padding-right: 16px;
    overflow: hidden;

    &:hover,
    &:active {
      color: ${colorTextPrimary};
    }
  }
`
const StyledGithubIcon = styled(GithubIcon)`
  height: 40px;
`

const StyledKofiIcon = styled(KofiIcon)`
  height: 40px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 24px;
`

function ComingSoonPage() {
  return (
    <ComingSoonRoot>
      <Headline5>This feature is coming soon!</Headline5>

      <FundingSection>
        <Subtitle1>Help fund ShieldBattery's development:</Subtitle1>
        <SupportLinks>
          <a
            href='https://github.com/sponsors/ShieldBattery'
            target='_blank'
            rel='noopener'
            title='GitHub Sponsors'>
            <StyledGithubIcon />
          </a>
          <a href='https://ko-fi.com/tec27' target='_blank' rel='noopener' title='Ko-fi'>
            <StyledKofiIcon />
          </a>
          <a href='https://patreon.com/tec27' target='_blank' rel='noopener' title='Patreon'>
            <StyledPatreonIcon />
          </a>
        </SupportLinks>
      </FundingSection>
    </ComingSoonRoot>
  )
}

const TotalGamesEntryRoot = styled.div`
  flex-shrink: 1;

  display: flex;
  align-items: center;
`

const RaceCircle = styled.div`
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  position: relative;
  margin-right: 12px;

  background-color: ${backgroundSaturatedDark};
  border: 6px solid ${backgroundSaturatedLight};
  border-radius: 50%;
`

const RaceCircleIcon = styled(RaceIcon)`
  position: absolute;
  width: 40px;
  height: 40px;
  top: calc(50% - 20px);
  left: calc(50% - 20px);

  fill: ${colorTextPrimary};
`

const TotalGamesText = styled.div`
  ${headline6};
  ${singleLine};
`

const WinLossText = styled.div`
  ${caption};
  color: ${colorTextSecondary};
`

function TotalGamesEntry({ race, wins, losses }: { race: RaceChar; wins: number; losses: number }) {
  const winrate = Math.round((wins * 100 * 10) / (wins + losses)) / 10

  return (
    <TotalGamesEntryRoot>
      <RaceCircle>
        <RaceCircleIcon race={race} />
      </RaceCircle>
      <div>
        <TotalGamesText>{wins + losses}</TotalGamesText>
        <WinLossText>
          {wins} W – {losses} L – {winrate}%
        </WinLossText>
      </div>
    </TotalGamesEntryRoot>
  )
}

const MatchHistoryRoot = styled.div`
  margin-bottom: 48px;
  /** 8 + 16px of internal padding in list = 24px */
  padding: 0 24px 0 8px;

  display: flex;
`

const GameList = styled.div`
  margin-right: 8px;
  flex-grow: 1;
`

const GamePreview = styled.div`
  width: 276px;
  flex-shrink: 0;

  background-color: ${background700};
  border-radius: 4px;
`

interface DummyGameReplaceWithRealThing {
  mapName: string
  matchType: string
  result: 'win' | 'loss' | 'unknown'
  date: Date
}

function MatchHistory() {
  const games: DummyGameReplaceWithRealThing[] = useMemo(
    () => [
      { mapName: 'Bluebastic Demon', matchType: 'Ranked 1v1', result: 'win', date: new Date() },
      {
        mapName: 'Lost Temple',
        matchType: 'Ranked 2v2',
        result: 'loss',
        date: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        mapName: 'Micro Tournament 2.7',
        matchType: 'Custom Lobby',
        result: 'win',
        date: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        mapName: 'Fighting Spirit',
        matchType: 'Ranked 1v1',
        result: 'loss',
        date: new Date(Date.now() - 27 * 60 * 60 * 1000),
      },
      {
        mapName: 'Big Game Hunters',
        matchType: 'Ranked 3v3',
        result: 'unknown',
        date: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    ],
    [],
  )

  return (
    <MatchHistoryRoot>
      <GameList>
        {games.map((g, i) => (
          <GameListEntry key={i} {...g} />
        ))}
      </GameList>
      <GamePreview></GamePreview>
    </MatchHistoryRoot>
  )
}

const GameListEntryRoot = styled.button`
  ${buttonReset};

  width: 100%;
  height: 64px;
  padding: 12px 16px;

  border-radius: 4px;
  text-align: left;

  & + & {
    margin-top: 8px;
  }
`

const GameListEntryTextRow = styled.div<{ $color?: 'primary' | 'secondary' }>`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: ${props => (props.$color === 'secondary' ? colorTextSecondary : colorTextPrimary)};
`

const GameListEntryResult = styled.div<{ $result: 'win' | 'loss' | 'unknown' }>`
  ${body2};
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return colorPositive
      case 'loss':
        return colorNegative
      default:
        return colorTextFaint
    }
  }};
  text-transform: capitalize;
`

function GameListEntry({ mapName, matchType, result, date }: DummyGameReplaceWithRealThing) {
  const [buttonProps, rippleRef] = useButtonState({})

  return (
    <GameListEntryRoot {...buttonProps}>
      <GameListEntryTextRow $color='primary'>
        <Body2>{mapName}</Body2>
        <GameListEntryResult $result={result}>{result}</GameListEntryResult>
      </GameListEntryTextRow>

      <GameListEntryTextRow $color='secondary'>
        <Body1>{matchType}</Body1>
        <Body1>{timeAgo(Date.now() - Number(date))}</Body1>
      </GameListEntryTextRow>

      <Ripple ref={rippleRef} />
    </GameListEntryRoot>
  )
}
