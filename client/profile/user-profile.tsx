import { Immutable } from 'immer'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameRecordJson } from '../../common/games/games'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUser, SbUserId, UserProfile } from '../../common/users/user-info'
import Avatar from '../avatars/avatar'
import { ComingSoon } from '../coming-soon/coming-soon'
import { RaceIcon } from '../lobbies/race-icon'
import { TabItem, Tabs } from '../material/tabs'
import { goToIndex } from '../navigation/action-creators'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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
import {
  correctUsernameForProfile,
  navigateToUserProfile,
  viewUserProfile,
} from './action-creators'
import { MiniMatchHistory } from './mini-match-history'
import { UserProfileSubPage } from './user-profile-sub-page'

const Container = styled.div`
  max-width: 960px;
  /* 18px + 6px from tab = 24px at top, 12px + 24px from tab = 36px from left */
  padding: 18px 12px 24px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
`

const LoadingError = styled.div`
  ${subtitle1};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
  padding: 0 24px;
`

export interface ConnectedUserProfilePageProps {
  userId: SbUserId
  username: string
  subPage?: UserProfileSubPage
}

export function ConnectedUserProfilePage({
  userId,
  username: usernameFromRoute,
  subPage = UserProfileSubPage.Summary,
}: ConnectedUserProfilePageProps) {
  if (isNaN(userId)) {
    goToIndex(replace)
  }

  const dispatch = useAppDispatch()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))
  const matchHistory = useAppSelector(s => s.users.idToMatchHistory.get(userId)) ?? []

  const onTabChange = useCallback(
    (tab: UserProfileSubPage) => {
      navigateToUserProfile(user!.id, user!.name, tab)
    },
    [user],
  )
  const [loadingError, setLoadingError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  // TODO(tec27): Move this inside the summary tab instead?
  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    dispatch(
      viewUserProfile(userId, {
        signal: abortController.signal,
        onSuccess: () => setLoadingError(undefined),
        onError: err => setLoadingError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, user, dispatch])

  useEffect(() => {
    if (user && usernameFromRoute !== user.name) {
      correctUsernameForProfile(user.id, user.name, subPage)
    }
  }, [usernameFromRoute, user, subPage])

  if (loadingError) {
    // TODO(tec27): Handle specific errors, e.g. not found vs server error
    return <LoadingError>There was a problem loading this user.</LoadingError>
  }
  if (!user || !profile) {
    return <LoadingDotsArea />
  }

  return (
    <UserProfilePage
      user={user}
      profile={profile}
      matchHistory={matchHistory}
      subPage={subPage}
      onTabChange={onTabChange}
    />
  )
}

export interface UserProfilePageProps {
  user: SbUser
  profile: UserProfile
  matchHistory: Immutable<GameRecordJson[]>
  subPage?: UserProfileSubPage
  onTabChange: (tab: UserProfileSubPage) => void
}

export function UserProfilePage({
  user,
  profile,
  matchHistory,
  subPage = UserProfileSubPage.Summary,
  onTabChange,
}: UserProfilePageProps) {
  let content: React.ReactNode
  switch (subPage) {
    case UserProfileSubPage.Summary:
      content = <SummaryPage user={user} profile={profile} matchHistory={matchHistory} />
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
        <Tabs activeTab={subPage} onChange={onTabChange}>
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

interface RaceStats {
  race: RaceChar
  wins: number
  losses: number
}

function SummaryPage({
  user,
  profile,
  matchHistory,
}: {
  user: SbUser
  profile: UserProfile
  matchHistory: Immutable<GameRecordJson[]>
}) {
  // TODO(tec27): Build the title feature :)
  const title = 'Novice'
  const ladder1v1 = profile.ladder[MatchmakingType.Match1v1]

  // TODO(tec27): Include random stats
  const stats = profile.userStats
  const pStats: RaceStats = { race: 'p', wins: stats.pWins, losses: stats.pLosses }
  const tStats: RaceStats = { race: 't', wins: stats.tWins, losses: stats.tLosses }
  const zStats: RaceStats = { race: 'z', wins: stats.zWins, losses: stats.zLosses }
  const sortedStats = [pStats, tStats, zStats].sort(
    (a, b) => b.wins + b.losses - (a.wins + a.losses),
  )

  return (
    <>
      <TopSection>
        <AvatarCircle>
          <StyledAvatar user={user.name} />
        </AvatarCircle>
        <UsernameAndTitle>
          <Username>{user.name}</Username>
          <Subtitle2>{title}</Subtitle2>
        </UsernameAndTitle>
        <RankInfo>
          <RankInfoEntry>
            <RankLabel>Current MMR</RankLabel>
            <RankValue $background='accent'>
              {ladder1v1 ? Math.round(ladder1v1.rating) : 'N/A'}
            </RankValue>
          </RankInfoEntry>
          <RankInfoEntry>
            <RankLabel>Current Rank</RankLabel>
            <RankValue $background='primary'>{ladder1v1?.rank ?? 'N/A'}</RankValue>
          </RankInfoEntry>
        </RankInfo>
      </TopSection>

      <SectionOverline>Total games</SectionOverline>
      <TotalGamesSection>
        {sortedStats.map((s, i) => (
          <React.Fragment key={s.race}>
            {i > 0 ? <TotalGamesSpacer /> : null}
            <TotalGamesEntry race={s.race} wins={s.wins} losses={s.losses} />
          </React.Fragment>
        ))}
      </TotalGamesSection>

      <SectionOverline>Latest games</SectionOverline>
      <MiniMatchHistory forUserId={user.id} games={matchHistory} />

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

function ComingSoonPage() {
  return (
    <ComingSoonRoot>
      <ComingSoon />
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
  const total = wins + losses
  const winrate = total > 0 ? Math.round((wins * 100 * 10) / total) / 10 : 0

  let raceText: string
  switch (race) {
    case 'p':
      raceText = 'Protoss'
      break
    case 't':
      raceText = 'Terran'
      break
    case 'z':
      raceText = 'Zerg'
      break
    case 'r':
      raceText = 'Random'
      break
    default:
      raceText = assertUnreachable(race)
  }

  return (
    <TotalGamesEntryRoot title={raceText}>
      <RaceCircle>
        <RaceCircleIcon race={race} ariaLabel={raceText} />
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
