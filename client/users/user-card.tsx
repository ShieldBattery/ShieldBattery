import { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  getRankedTypesByActivity,
  ladderPlayerToMatchmakingDivision,
} from '../../common/ladder/ladder'
import {
  getTotalBonusPoolForSeason,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserProfileJson } from '../../common/users/user-network'
import { ConnectedAvatar } from '../avatars/avatar'
import { FilledButton } from '../material/button'
import {
  getInlineCardHeight,
  INLINE_CARD_INFO_GAP,
  INLINE_CARD_THUMBNAIL_SIZE,
  InlineCardGone,
  InlineCardInfoColumn,
  InlineCardLoading,
  InlineCardRoot,
  InlineCardSecondaryLine,
  InlineCardTitle,
} from '../messaging/inline-card'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { navigateToUserProfile, viewUserProfile } from './action-creators'

// The info column stacks 3 rows (name, ranks, win/loss record) separated by the shared info gap;
// their combined height comes straight from the typography tokens those rows render with
// (`titleSmall`/`bodySmall`'s `line-height`, see client/styles/typography.ts) rather than a guessed
// number, so it stays correct if either token's line-height ever changes.
const NAME_LINE_HEIGHT = 20 // titleSmall
const SECONDARY_LINE_HEIGHT = 16 // bodySmall
const INFO_STACK_HEIGHT = NAME_LINE_HEIGHT + SECONDARY_LINE_HEIGHT * 2 + INLINE_CARD_INFO_GAP * 2

const CARD_HEIGHT = getInlineCardHeight(INFO_STACK_HEIGHT)

const CardAvatar = styled(ConnectedAvatar)`
  width: ${INLINE_CARD_THUMBNAIL_SIZE}px;
  height: ${INLINE_CARD_THUMBNAIL_SIZE}px;
  flex-shrink: 0;
`

// A long name gives the info column a large flex basis that would otherwise shrink the button past
// its label (which hard-clips, since the button contains its content); the name is the one that
// truncates instead.
const ProfileButton = styled(FilledButton)`
  flex-shrink: 0;
`

export type UserCardState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'loaded'
      profile: ReadonlyDeep<UserProfileJson>
      season: ReadonlyDeep<MatchmakingSeasonJson> | undefined
    }

export interface UserCardContentProps {
  userId: SbUserId
  /** The user's current display name, when the client knows it. */
  name: string | undefined
  state: UserCardState
  onProfileClick: () => void
}

/**
 * The presentational part of {@link UserCard}: renders the loading/error/loaded states without
 * fetching anything itself, so it can be driven directly (e.g. from a devonly test page).
 *
 * The loading state renders a placeholder sized to match the loaded card so the message it's
 * attached to doesn't grow again once the profile arrives; the error state collapses to a single
 * line, which only ever shrinks the card (growth is what breaks the message list's autoscroll).
 */
export function UserCardContent({ userId, name, state, onProfileClick }: UserCardContentProps) {
  const { t } = useTranslation()

  if (state.status === 'loading') {
    return <InlineCardLoading $height={CARD_HEIGHT} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return (
      <InlineCardGone>
        {t('users.card.loadError', "Couldn't load this user's profile.")}
      </InlineCardGone>
    )
  }

  const { profile, season } = state
  const rankText = rankLineText(profile, season, t)
  const recordText = recordLineText(profile, t)

  return (
    <InlineCardRoot $height={CARD_HEIGHT}>
      <CardAvatar userId={userId} />
      <InlineCardInfoColumn>
        <InlineCardTitle title={name}>{name ?? ''}</InlineCardTitle>
        <InlineCardSecondaryLine title={rankText}>{rankText}</InlineCardSecondaryLine>
        <InlineCardSecondaryLine title={recordText}>{recordText}</InlineCardSecondaryLine>
      </InlineCardInfoColumn>
      <ProfileButton
        label={t('users.card.viewProfile', 'Profile')}
        onClick={onProfileClick}
        testName='user-card-profile-button'
      />
    </InlineCardRoot>
  )
}

/**
 * Formats the user's ranked modes, most active first, as "<mode> <division>" entries. Without the
 * season the division can't be computed (it depends on how large the bonus pool has grown), so the
 * mode names are shown on their own.
 */
function rankLineText(
  profile: ReadonlyDeep<UserProfileJson>,
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined,
  t: TFunction,
): string {
  const rankedTypes = getRankedTypesByActivity(profile.ladder)
  if (!rankedTypes.length) {
    return t('users.card.unranked', 'Unranked')
  }

  if (!season) {
    return rankedTypes.map(type => matchmakingTypeToLabel(type, t)).join(' · ')
  }

  const bonusPool = getTotalBonusPoolForSeason(new Date(), season)
  return rankedTypes
    .map(type => {
      const division = ladderPlayerToMatchmakingDivision(profile.ladder[type]!, bonusPool)
      return `${matchmakingTypeToLabel(type, t)} ${matchmakingDivisionToLabel(division, t)}`
    })
    .join(' · ')
}

function recordLineText(profile: ReadonlyDeep<UserProfileJson>, t: TFunction): string {
  const { pWins, tWins, zWins, rWins, pLosses, tLosses, zLosses, rLosses } = profile.userStats
  const wins = pWins + tWins + zWins + rWins
  const losses = pLosses + tLosses + zLosses + rLosses
  const total = wins + losses

  if (!total) {
    return t('users.card.noGames', 'No games played')
  }

  return t('users.card.record', {
    defaultValue: '{{count}} games · {{wins}}–{{losses}}',
    // eslint-disable-next-line camelcase -- i18next's plural-form key convention
    defaultValue_one: '{{count}} game · {{wins}}–{{losses}}',
    count: total,
    wins,
    losses,
  })
}

/**
 * A compact card for a user: their avatar, name, ranked divisions and overall win/loss record, plus
 * a button to open their full profile. Fetches the profile itself, so it can be rendered for any
 * user id; a profile loaded by an earlier view is shown immediately while the fetch refreshes it.
 */
export function UserCard({ userId }: { userId: SbUserId }) {
  const dispatch = useAppDispatch()
  const cancelLoadRef = useRef(new AbortController())
  const [loadingError, setLoadingError] = useState<Error>()

  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))
  const season = useAppSelector(s =>
    profile ? s.matchmakingSeasons.byId.get(profile.seasonId) : undefined,
  )

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

  let state: UserCardState
  if (loadingError) {
    state = { status: 'error' }
  } else if (profile) {
    state = { status: 'loaded', profile, season }
  } else {
    state = { status: 'loading' }
  }

  return (
    <UserCardContent
      userId={userId}
      name={user?.name}
      state={state}
      onProfileClick={() => navigateToUserProfile(userId, user?.name ?? '')}
    />
  )
}
