import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingDivisionToLabel,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user'
import { UserStats } from '../../common/users/user-stats'
import { ConnectedAvatar } from '../avatars/avatar'
import { longTimestamp } from '../i18n/date-formats'
import { LadderPlayerIcon } from '../matchmaking/rank-icon'
import { Popover, PopoverProps } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  background500,
  background900,
  backgroundSaturatedDark,
  backgroundSaturatedLight,
  colorDividers,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import {
  Body1,
  body1,
  body2,
  buttonText,
  caption,
  headline6,
  overline,
  singleLine,
  subtitle1,
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
      <OverlayContents userId={userId} onDismiss={onDismiss} />
    </Popover>
  )
}

const PopoverContents = styled.div`
  min-width: 256px;
  min-height: 200px;
  padding: 16px 16px 8px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const LoadingError = styled.div`
  ${subtitle1};
  width: 100%;
`

const ViewProfileHover = styled.div`
  ${buttonText};

  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  padding: 8px 0;

  background: ${background900};
  border-radius: 100%;
  opacity: 0;
  transition: opacity 75ms linear;

  font-size: 10px;
  line-height: 20px;
  text-align: center;
`

const IdentityArea = styled.div`
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
`

const AvatarCircle = styled.div`
  width: 64px;
  height: 64px;
  position: relative;

  background-color: ${backgroundSaturatedDark};
  border: 8px solid ${backgroundSaturatedLight};
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
`

const Username = styled.div`
  ${headline6};
  ${singleLine};
`

const LoadingUsername = styled.div`
  width: 48px;
  height: 20px;
  margin: 4px 0;

  background-color: ${colorDividers};
  border-radius: 2px;
`

const Title = styled.div`
  ${body2};
  color: ${colorTextSecondary};
`

const SectionHeader = styled.div`
  ${overline};
  ${singleLine};
  margin: 4px 0;
  color: ${colorTextFaint};
`

const HintText = styled.div`
  ${caption};
  color: ${colorTextFaint};
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
function OverlayContents({ userId, onDismiss }: { userId: SbUserId; onDismiss: () => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const cancelLoadRef = useRef(new AbortController())
  const [loadingError, setLoadingError] = useState<Error>()

  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))

  const username = user?.name
  const onIdentityClick = useCallback(() => {
    onDismiss()
    navigateToUserProfile(userId, username ?? '')
  }, [userId, username, onDismiss])

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
      <IdentityArea onClick={onIdentityClick}>
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
            <LoadingUsername aria-label='Username loading…' />
          )}
          <Title>{t('users.titles.novice', 'Novice')}</Title>
        </UsernameAndTitle>
      </IdentityArea>
      {profile ? (
        <>
          <div>
            <SectionHeader>{t('users.profileOverlay.info', 'Info')}</SectionHeader>
            <Tooltip text={longFormattedDate}>
              <Body1>
                {t('users.profileOverlay.joined', {
                  defaultValue: 'Joined {{date}}',
                  date: joinDateFormat.format(profile.created),
                })}
              </Body1>
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

      <HintText>
        {t('users.profileOverlay.rightClick', 'Right-click user for more actions')}
      </HintText>
    </PopoverContents>
  )
}

const TotalGameText = styled.span`
  ${subtitle1};
  margin-right: 12px;
`

const WinLossText = styled.span`
  ${body1};
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

  background-color: ${background500};
  border-radius: 4px;
`

const DivisionIcon = styled(LadderPlayerIcon)`
  width: 88px;
  height: 88px;
`

const RankDisplayType = styled.div`
  ${body2};
  ${singleLine};
  padding-top: 4px;
  color: ${colorTextSecondary};
`

function RankDisplay({
  matchmakingType,
  ladderPlayer,
}: {
  matchmakingType: MatchmakingType
  ladderPlayer: LadderPlayer
}) {
  const { t } = useTranslation()
  const division = ladderPlayerToMatchmakingDivision(ladderPlayer)
  const divisionLabel = matchmakingDivisionToLabel(division, t)

  return (
    <RankDisplayRoot>
      <Tooltip text={divisionLabel} position={'top'}>
        <DivisionIcon player={ladderPlayer} size={88} />
      </Tooltip>
      <RankDisplayType>{matchmakingTypeToLabel(matchmakingType, t)}</RankDisplayType>
    </RankDisplayRoot>
  )
}
