import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingSeasonJson,
  MatchmakingType,
  getTotalBonusPoolForSeason,
  matchmakingDivisionToLabel,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserStats } from '../../common/users/user-stats'
import { ConnectedAvatar } from '../avatars/avatar'
import { longTimestamp } from '../i18n/date-formats'
import { LadderPlayerIcon } from '../matchmaking/rank-icon'
import { Popover, PopoverProps } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  BodyMedium,
  bodyLarge,
  bodyMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { navigateToUserProfile, viewUserProfile } from './action-creators'

const joinDateFormat = new Intl.DateTimeFormat(navigator.language, {
  month: 'long',
  year: 'numeric',
})

export interface ConnectedUserProfileOverlayProps {
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserProfileOverlay({
  userId,
  popoverProps,
}: ConnectedUserProfileOverlayProps) {
  const onDismiss = popoverProps.onDismiss

  return (
    <Popover {...popoverProps}>
      <UserProfileOverlayContents userId={userId} onDismiss={onDismiss} />
    </Popover>
  )
}

const PopoverContents = styled.div`
  min-width: 256px;
  min-height: 200px;
  padding: 16px 16px 8px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
`

const LoadingError = styled.div`
  ${bodyLarge};
  width: 100%;
`

const ViewProfileHover = styled.div`
  ${labelSmall};

  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  padding: 8px 0;

  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;

  background: var(--color-blue10);
  border-radius: 100%;
  opacity: 0;
  transition: opacity 75ms linear;
`

const IdentityArea = styled.div`
  width: 100%;
  height: 64px;
  display: flex;
  align-items: center;
  gap: 16px;

  &:hover {
    cursor: pointer;
  }

  &:hover ${ViewProfileHover} {
    opacity: 0.8;
  }
`

const AvatarContainer = styled.div`
  position: relative;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

const AvatarCircle = styled.div`
  width: 64px;
  height: 64px;
  position: relative;

  background-color: var(--color-blue30);
  border: 8px solid var(--color-blue40);
  border-radius: 50%;
`

const StyledAvatar = styled(ConnectedAvatar)`
  position: absolute;
  width: 36px;
  height: 36px;
  top: calc(50% - 18px);
  left: calc(50% - 18px);
`

const UsernameAndTitle = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
  overflow: hidden;
`

const Username = styled.div`
  ${titleLarge};
  ${singleLine};
`

const LoadingUsername = styled.div`
  width: 48px;
  height: 20px;
  margin: 4px 0;

  background-color: rgb(from var(--theme-on-surface-variant) r g b / 0.7);
  border-radius: 4px;
`

const Title = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface-variant);
`

const SectionHeader = styled.div`
  ${labelMedium};
  ${singleLine};
  margin: 4px 0;
  color: var(--theme-on-surface-variant);
`

const HintText = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const RankDisplaySection = styled.div`
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
`

// NOTE(tec27): We need to push this content down a level from the Popover so the hooks inside only
// run when it's visible (otherwise we'd request all the user profiles once they e.g. appeared in
// the user list)
export function UserProfileOverlayContents({
  userId,
  showHintText = true,
  onDismiss,
}: {
  userId: SbUserId
  showHintText?: boolean
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const cancelLoadRef = useRef(new AbortController())
  const [loadingError, setLoadingError] = useState<Error>()

  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))
  const season = useAppSelector(s =>
    profile ? s.matchmakingSeasons.byId.get(profile.seasonId) : undefined,
  )

  const username = user?.name

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
  }, [dispatch, userId])

  const hasAnyRanks = !!Object.keys(profile?.ladder ?? {}).length
  const longFormattedDate = longTimestamp.format(profile?.created)

  return (
    <PopoverContents>
      {loadingError ? (
        <LoadingError>
          {t('users.errors.profile.loadUser', 'There was a problem loading this user.')}
        </LoadingError>
      ) : null}
      <IdentityArea
        onClick={() => {
          onDismiss?.()
          navigateToUserProfile(userId, username ?? '')
        }}>
        <AvatarContainer>
          <AvatarCircle>
            <StyledAvatar userId={userId} />
          </AvatarCircle>
          <ViewProfileHover>
            {t('users.profileOverlay.viewProfile', 'View profile')}
          </ViewProfileHover>
        </AvatarContainer>
        <UsernameAndTitle>
          {user ? (
            <Username>{user.name}</Username>
          ) : (
            <LoadingUsername aria-label={t('common.loading.username', 'Username loading…')} />
          )}
          <Title>{t('users.titles.novice', 'Novice')}</Title>
        </UsernameAndTitle>
      </IdentityArea>
      {profile ? (
        <>
          <div>
            <SectionHeader>{t('users.profileOverlay.info', 'Info')}</SectionHeader>
            <Tooltip text={longFormattedDate}>
              <BodyMedium>
                {t('users.profileOverlay.joined', {
                  defaultValue: 'Joined {{date}}',
                  date: joinDateFormat.format(profile.created),
                })}
              </BodyMedium>
            </Tooltip>
          </div>

          <div>
            <SectionHeader>{t('users.profile.totalGames', 'Total games')}</SectionHeader>
            <TotalGameStats userStats={profile.userStats} />
          </div>

          {hasAnyRanks ? (
            <div>
              <SectionHeader>{t('users.profileOverlay.ranked', 'Ranked')}</SectionHeader>
              <RankDisplaySection>
                {ALL_MATCHMAKING_TYPES.map(matchmakingType =>
                  profile.ladder[matchmakingType] ? (
                    <RankDisplay
                      key={matchmakingType}
                      matchmakingType={matchmakingType}
                      ladderPlayer={profile.ladder[matchmakingType]!}
                      season={season!}
                    />
                  ) : null,
                )}
              </RankDisplaySection>
            </div>
          ) : null}
        </>
      ) : (
        <LoadingDotsArea />
      )}

      {showHintText ? (
        <HintText>
          {t('users.profileOverlay.rightClick', 'Right-click user for more actions')}
        </HintText>
      ) : null}
    </PopoverContents>
  )
}

const TotalGameText = styled.span`
  ${bodyLarge};
  margin-right: 12px;
`

const WinLossText = styled.span`
  ${bodyMedium};
`

function TotalGameStats({ userStats }: { userStats: UserStats }) {
  const { pWins, tWins, zWins, rWins, pLosses, tLosses, zLosses, rLosses } = userStats
  const wins = pWins + tWins + zWins + rWins
  const losses = pLosses + tLosses + zLosses + rLosses
  const totalGames = wins + losses

  return (
    <div>
      <TotalGameText>{totalGames}</TotalGameText>
      {totalGames > 0 ? (
        <WinLossText>
          ({wins} &ndash; {losses})
        </WinLossText>
      ) : null}
    </div>
  )
}

const RankDisplayRoot = styled.div`
  width: 108px;
  padding: 8px 8px 4px;

  display: flex;
  flex-direction: column;
  align-items: center;

  background-color: var(--theme-container-high);
  border-radius: 4px;
`

const DivisionIcon = styled(LadderPlayerIcon)`
  width: 88px;
  height: 88px;
`

const RankDisplayType = styled.div`
  ${titleSmall};
  ${singleLine};
  padding-top: 4px;
  color: var(--theme-on-surface-variant);
`

function RankDisplay({
  matchmakingType,
  ladderPlayer,
  season,
}: {
  matchmakingType: MatchmakingType
  ladderPlayer: LadderPlayer
  season: ReadonlyDeep<MatchmakingSeasonJson>
}) {
  const { t } = useTranslation()
  const bonusPool = getTotalBonusPoolForSeason(new Date(), season)
  const division = ladderPlayerToMatchmakingDivision(ladderPlayer, bonusPool)
  const divisionLabel = matchmakingDivisionToLabel(division, t)

  return (
    <RankDisplayRoot>
      <Tooltip text={divisionLabel} position={'top'}>
        <DivisionIcon player={ladderPlayer} size={88} bonusPool={bonusPool} />
      </Tooltip>
      <RankDisplayType>{matchmakingTypeToLabel(matchmakingType, t)}</RankDisplayType>
    </RankDisplayRoot>
  )
}
