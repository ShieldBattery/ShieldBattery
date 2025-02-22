import { Immutable } from 'immer'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameRecordJson } from '../../common/games/games'
import { ALL_MATCHMAKING_TYPES, MatchmakingSeasonJson, SeasonId } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUser, SbUserId, UserProfileJson } from '../../common/users/sb-user'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { ConnectedAvatar } from '../avatars/avatar'
import { ComingSoon } from '../coming-soon/coming-soon'
import { RaceIcon } from '../lobbies/race-icon'
import { TabItem, Tabs } from '../material/tabs'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  amberA400,
  backgroundSaturatedDark,
  backgroundSaturatedLight,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { selectableTextContainer } from '../styles/text-selection'
import {
  bodyLarge,
  bodySmall,
  displaySmall,
  labelMedium,
  singleLine,
  titleLarge,
  TitleMedium,
} from '../styles/typography'
import {
  correctUsernameForProfile,
  navigateToUserProfile,
  viewUserProfile,
} from './action-creators'
import { ConnectedMatchHistory } from './match-history'
import { MiniMatchHistory } from './mini-match-history'
import { UserProfileSeasons } from './user-profile-seasons'
import { UserProfileSubPage } from './user-profile-sub-page'
import { UserRankDisplay } from './user-rank-display'

const LoadableAdminUserPage = React.lazy(async () => ({
  default: (await import('./user-profile-admin')).AdminUserPage,
}))

const Container = styled.div`
  max-width: 960px;
  /* 12px + 24px from tab = 36px from left */
  padding: 24px 12px;
`

const LoadingError = styled.div`
  ${bodyLarge};
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
    replace('/')
  }

  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))
  const matchHistory = useAppSelector(s => s.users.idToMatchHistory.get(userId)) ?? []
  const isAdmin = useHasAnyPermission('editPermissions', 'banUsers')
  const seasons = useAppSelector(s => s.matchmakingSeasons.byId)

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

  useEffect(() => {
    if (subPage === UserProfileSubPage.Admin && !isAdmin) {
      navigateToUserProfile(userId, usernameFromRoute, UserProfileSubPage.Summary, replace)
    }
  }, [subPage, isAdmin, userId, usernameFromRoute])

  if (loadingError) {
    // TODO(tec27): Handle specific errors, e.g. not found vs server error
    return (
      <LoadingError>
        {t('users.errors.profile.loadUser', 'There was a problem loading this user.')}
      </LoadingError>
    )
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
      isAdmin={isAdmin}
      seasons={seasons}
    />
  )
}

const TopSection = styled.div`
  height: 100px;
  width: 100%;
  margin-bottom: 32px;
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

const StyledAvatar = styled(ConnectedAvatar)`
  position: absolute;
  width: 56px;
  height: 56px;
  top: calc(50% - 28px);
  left: calc(50% - 28px);
`

const UsernameAndTitle = styled.div`
  ${selectableTextContainer};
  flex-grow: 1;
  margin-left: 24px;
`

const Username = styled.div`
  ${displaySmall};
  ${singleLine};
  color: ${amberA400};
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
  margin-bottom: 24px;
  padding: 0 24px;
`

export interface UserProfilePageProps {
  user: SbUser
  profile: UserProfileJson
  matchHistory: Immutable<GameRecordJson[]>
  subPage?: UserProfileSubPage
  onTabChange: (tab: UserProfileSubPage) => void
  isAdmin: boolean
  seasons: ReadonlyDeep<Map<SeasonId, MatchmakingSeasonJson>>
}

export function UserProfilePage({
  user,
  profile,
  matchHistory,
  subPage = UserProfileSubPage.Summary,
  onTabChange,
  isAdmin,
  seasons,
}: UserProfilePageProps) {
  const { t } = useTranslation()
  // TODO(tec27): Build the title feature :)
  const title = t('users.titles.novice', 'Novice')

  let content: React.ReactNode
  switch (subPage) {
    case UserProfileSubPage.Summary:
      content = (
        <SummaryPage user={user} profile={profile} matchHistory={matchHistory} seasons={seasons} />
      )
      break

    case UserProfileSubPage.MatchHistory:
      content = <ConnectedMatchHistory userId={user.id} />
      break

    case UserProfileSubPage.Stats:
      content = <ComingSoonPage />
      break

    case UserProfileSubPage.Seasons:
      content = <UserProfileSeasons user={user} />
      break

    case UserProfileSubPage.Admin:
      // Parent component should navigate away from this page in a useEffect if not admin, so null
      // is fine in that case
      content = isAdmin ? (
        <React.Suspense fallback={<LoadingDotsArea />}>
          <LoadableAdminUserPage user={user} />{' '}
        </React.Suspense>
      ) : null
      break

    default:
      content = assertUnreachable(subPage)
  }

  return (
    <Container>
      <TopSection>
        <AvatarCircle>
          <StyledAvatar userId={user.id} />
        </AvatarCircle>
        <UsernameAndTitle>
          <Username>{user.name}</Username>
          <TitleMedium>{title}</TitleMedium>
        </UsernameAndTitle>
      </TopSection>

      <TabArea>
        <Tabs activeTab={subPage} onChange={onTabChange}>
          <TabItem
            value={UserProfileSubPage.Summary}
            text={t('users.profile.tabs.summary', 'Summary')}
          />
          <TabItem value={UserProfileSubPage.Stats} text={t('users.profile.tabs.stats', 'Stats')} />
          <TabItem
            value={UserProfileSubPage.MatchHistory}
            text={t('users.profile.tabs.matchHistory', 'Match history')}
          />
          <TabItem
            value={UserProfileSubPage.Seasons}
            text={t('users.profile.tabs.season', 'Seasons')}
          />
          {isAdmin ? (
            <TabItem
              value={UserProfileSubPage.Admin}
              text={t('users.profile.tabs.admin', 'Admin')}
            />
          ) : null}
        </Tabs>
      </TabArea>

      {content}
    </Container>
  )
}

const SectionOverline = styled.div`
  ${labelMedium};
  ${singleLine};
  color: ${colorTextFaint};
  margin: 12px 24px;
`

const RankedSection = styled.div`
  padding: 0 24px;
  margin-bottom: 48px;
  &:empty {
    // Don't add extra margin if the player only has ranks that are still in placements (and thus
    // not shown)
    margin-bottom: 0;
  }

  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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
  ${bodyLarge};
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
  seasons,
}: {
  user: SbUser
  profile: UserProfileJson
  matchHistory: Immutable<GameRecordJson[]>
  seasons: ReadonlyDeep<Map<SeasonId, MatchmakingSeasonJson>>
}) {
  const { t } = useTranslation()

  const stats = profile.userStats
  const pStats: RaceStats = {
    race: 'p',
    wins: stats.pWins + stats.rPWins,
    losses: stats.pLosses + stats.rPLosses,
  }
  const tStats: RaceStats = {
    race: 't',
    wins: stats.tWins + stats.rTWins,
    losses: stats.tLosses + stats.rTLosses,
  }
  const zStats: RaceStats = {
    race: 'z',
    wins: stats.zWins + stats.rZWins,
    losses: stats.zLosses + stats.rZLosses,
  }
  const sortedStats = [pStats, tStats, zStats].sort(
    (a, b) => b.wins + b.losses - (a.wins + a.losses),
  )

  const hasAnyRanks = !!Object.keys(profile.ladder).length

  return (
    <>
      {hasAnyRanks && (
        <>
          <RankedSection>
            {ALL_MATCHMAKING_TYPES.map(matchmakingType =>
              profile.ladder[matchmakingType] ? (
                <UserRankDisplay
                  key={matchmakingType}
                  matchmakingType={matchmakingType}
                  ladderPlayer={profile.ladder[matchmakingType]!}
                  season={seasons.get(profile.seasonId)!}
                />
              ) : null,
            )}
          </RankedSection>
        </>
      )}

      <SectionOverline>{t('users.profile.totalGames', 'Total games')}</SectionOverline>
      <TotalGamesSection>
        {sortedStats.map((s, i) => (
          <React.Fragment key={s.race}>
            {i > 0 ? <TotalGamesSpacer /> : null}
            <TotalGamesEntry race={s.race} wins={s.wins} losses={s.losses} />
          </React.Fragment>
        ))}
      </TotalGamesSection>

      <SectionOverline>{t('users.profile.latestGames', 'Latest games')}</SectionOverline>
      <MiniMatchHistory forUserId={user.id} games={matchHistory} />

      <SectionOverline>{t('users.profile.achievements', 'Achievements')}</SectionOverline>
      <EmptyListText>{t('common.lists.empty', 'Nothing to see here')}</EmptyListText>
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
  ${titleLarge};
  ${singleLine};
`

const WinLossText = styled.div`
  ${bodySmall};
  color: ${colorTextSecondary};
`

function TotalGamesEntry({ race, wins, losses }: { race: RaceChar; wins: number; losses: number }) {
  const { t } = useTranslation()

  const total = wins + losses
  const winrate = total > 0 ? Math.round((wins * 100 * 10) / total) / 10 : 0

  let raceText: string
  switch (race) {
    case 'p':
      raceText = t('game.race.protoss', 'Protoss')
      break
    case 't':
      raceText = t('game.race.terran', 'Terran')
      break
    case 'z':
      raceText = t('game.race.zerg', 'Zerg')
      break
    case 'r':
      raceText = t('game.race.random', 'Random')
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
          {wins} {t('game.results.winShort', 'W')} &ndash; {losses}{' '}
          {t('game.results.lossShort', 'L')} &ndash; {winrate}%
        </WinLossText>
      </div>
    </TotalGamesEntryRoot>
  )
}
