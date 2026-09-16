import { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getResultLabel, getResultShortLabel } from '../../common/games/results'
import {
  getRankedTypesByActivity,
  ladderPlayerToMatchmakingDivision,
} from '../../common/ladder/ladder'
import {
  getTotalBonusPoolForSeason,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserProfileJson } from '../../common/users/user-network'
import { ConnectedAvatar } from '../avatars/avatar'
import { PlayerResultChip } from '../games/result-chip'
import { DivisionIcon } from '../matchmaking/rank-icon'
import { FilledButton } from '../material/button'
import {
  getInlineCardHeight,
  INLINE_CARD_INFO_GAP,
  INLINE_CARD_THUMBNAIL_SIZE,
  InlineCardGone,
  InlineCardInfoColumn,
  InlineCardLoading,
  InlineCardRoot,
  InlineCardTitle,
} from '../messaging/inline-card'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodySmall, singleLine } from '../styles/typography'
import { navigateToUserProfile, viewUserProfile } from './action-creators'

// The info column stacks 3 rows: the display name, the most-played ranked mode's division badge
// and label, and the all-time win/loss record. The name and record rows are plain text, so their
// height comes from the typography token they render with (`titleSmall`/`bodySmall`'s
// `line-height`, see client/styles/typography.ts); the rank row's height instead comes from its
// division badge, which is drawn taller than the `bodySmall` text beside it.
const NAME_LINE_HEIGHT = 20 // titleSmall
const RANK_BADGE_SIZE = 20
const RANK_LINE_HEIGHT = RANK_BADGE_SIZE
const RECORD_LINE_HEIGHT = 16 // bodySmall
const INFO_STACK_HEIGHT =
  NAME_LINE_HEIGHT + RANK_LINE_HEIGHT + RECORD_LINE_HEIGHT + INLINE_CARD_INFO_GAP * 2

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

const RankLineRoot = styled.div`
  height: ${RANK_LINE_HEIGHT}px;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 4px;

  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const RankBadge = styled(DivisionIcon)`
  width: ${RANK_BADGE_SIZE}px;
  height: ${RANK_BADGE_SIZE}px;
  flex-shrink: 0;
`

const RankText = styled.span`
  ${singleLine};
  min-width: 0;
`

const RecordLine = styled.div`
  height: ${RECORD_LINE_HEIGHT}px;
  min-width: 0;

  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;

  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Count = styled.span`
  margin-right: 8px;
`

const Separator = styled.span`
  margin-right: 4px;
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
  const rankLine = getRankLine(profile, season, t)
  const { pWins, tWins, zWins, rWins, pLosses, tLosses, zLosses, rLosses } = profile.userStats
  const wins = pWins + tWins + zWins + rWins
  const losses = pLosses + tLosses + zLosses + rLosses
  const totalGames = wins + losses

  return (
    <InlineCardRoot $height={CARD_HEIGHT}>
      <CardAvatar userId={userId} />
      <InlineCardInfoColumn>
        <InlineCardTitle title={name}>{name ?? ''}</InlineCardTitle>
        <RankLineRoot title={rankLine.tooltip}>
          {rankLine.kind !== 'seasonUnknown' ? (
            <RankBadge division={rankLine.badge} size={RANK_BADGE_SIZE} />
          ) : null}
          <RankText>{rankLine.text}</RankText>
        </RankLineRoot>
        {totalGames > 0 ? (
          <RecordLine>
            <PlayerResultChip
              $result='win'
              role='img'
              aria-label={getResultLabel('win', t)}
              title={getResultLabel('win', t)}>
              {getResultShortLabel('win', t)}
            </PlayerResultChip>
            <Count>{wins}</Count>
            <PlayerResultChip
              $result='loss'
              role='img'
              aria-label={getResultLabel('loss', t)}
              title={getResultLabel('loss', t)}>
              {getResultShortLabel('loss', t)}
            </PlayerResultChip>
            <Count>{losses}</Count>
            <Separator>·</Separator>
            {t('users.card.totalGames', {
              defaultValue: '{{count}} games',
              // eslint-disable-next-line camelcase -- i18next's plural-form key convention
              defaultValue_one: '{{count}} game',
              count: totalGames,
            })}
          </RecordLine>
        ) : (
          <RecordLine>{t('users.card.noGames', 'No games played')}</RecordLine>
        )}
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
 * The user card's rank line for the user's most-played ranked matchmaking mode, in one of three
 * states: they haven't played a ranked mode at all, they have but the season's bonus pool hasn't
 * loaded (so a division can't be computed), or a division and point total are both available.
 */
export type RankLine =
  | { kind: 'unranked'; badge: MatchmakingDivision; text: string; tooltip: string }
  | { kind: 'seasonUnknown'; text: string; tooltip: string }
  | { kind: 'ranked'; badge: MatchmakingDivision; text: string; tooltip: string }

/**
 * Computes the user card's rank line for the user's most-played ranked mode
 * (`getRankedTypesByActivity` sorts by activity, so the first entry is the one to show). The
 * tooltip always covers every ranked mode the user has played, most-played first, so hovering the
 * line reveals the modes the compact text leaves out.
 */
export function getRankLine(
  profile: ReadonlyDeep<UserProfileJson>,
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined,
  t: TFunction,
): RankLine {
  const rankedTypes = getRankedTypesByActivity(profile.ladder)
  if (!rankedTypes.length) {
    const text = t('users.card.unranked', 'Unranked')
    return { kind: 'unranked', badge: MatchmakingDivision.Unrated, text, tooltip: text }
  }

  if (!season) {
    const text = rankedTypes.map(type => matchmakingTypeToLabel(type, t)).join(' · ')
    return { kind: 'seasonUnknown', text, tooltip: text }
  }

  const bonusPool = getTotalBonusPoolForSeason(new Date(), season)
  const [mostPlayedType] = rankedTypes
  const player = profile.ladder[mostPlayedType]!
  const division = ladderPlayerToMatchmakingDivision(player, bonusPool)
  const text = t('users.card.rankLine', '{{division}} · {{mode}} · {{points}} pts', {
    division: matchmakingDivisionToLabel(division, t),
    mode: matchmakingTypeToLabel(mostPlayedType, t),
    points: Math.round(player.points).toLocaleString(),
  })
  const tooltip = rankedTypes
    .map(type => {
      const typeDivision = ladderPlayerToMatchmakingDivision(profile.ladder[type]!, bonusPool)
      return `${matchmakingTypeToLabel(type, t)} ${matchmakingDivisionToLabel(typeDivision, t)}`
    })
    .join(' · ')

  return { kind: 'ranked', badge: division, text, tooltip }
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
