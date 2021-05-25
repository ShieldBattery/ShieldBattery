import React, { useCallback } from 'react'
import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import Avatar from '../avatars/avatar'
import { RaceIcon } from '../lobbies/race-icon'
import { TabItem, Tabs } from '../material/tabs'
import { push } from '../navigation/routing'
import { urlPath } from '../network/urls'
import {
  amberA400,
  backgroundSaturatedDark,
  backgroundSaturatedLight,
  blue400,
  colorTextFaint,
  colorTextInvert,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import {
  caption,
  headline3,
  headline6,
  overline,
  singleLine,
  subtitle1,
  Subtitle2,
} from '../styles/typography'

const Container = styled.div`
  max-width: 960px;
  /* 18px + 6px from tab = 24px at top, 12px + 24px from tab = 36px from left */
  padding: 18px 12px 24px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
`

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
  display: flex;
  padding: 0 24px;
  align-items: center;
`

const TotalGamesSpacer = styled.div`
  width: 8px;
  height: 1px;
  flex-grow: 1;
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

  const title = 'Biggus Fannius'
  const mmr = 1698
  const rank = 1

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
    </Container>
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
