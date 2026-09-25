import { TFunction } from 'i18next'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
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
  MatchmakingType,
  matchmakingTypeToLabel,
  NUM_PLACEMENT_MATCHES,
} from '../../common/matchmaking'
import { RaceChar, raceCharToLabel, RaceStats } from '../../common/races'
import { apiUrl } from '../../common/urls'
import { SbUser } from '../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { GetUserProfileResponse, UserProfileJson } from '../../common/users/user-network'
import { ConnectedAvatar } from '../avatars/avatar'
import { dispatch as globalDispatch } from '../dispatch-registry'
import { PlayerResultChip } from '../games/result-chip'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { RaceIcon } from '../lobbies/race-icon'
import { DivisionIcon } from '../matchmaking/rank-icon'
import {
  BackdropCard,
  BackdropCardGone,
  BackdropCardHeader,
  BackdropCardLoading,
  BackdropCardMeta,
  BackdropCardMetaText,
  BackdropCardTitle,
  backdropTextShadow,
  CardClickBoundary,
  CardTooltip,
  getBackdropCardHeight,
} from '../messaging/backdrop-card'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { getRaceColor } from '../styles/colors'
import { bodySmall, singleLine, titleMedium, titleTiny } from '../styles/typography'
import { navigateToUserProfile, viewUserProfile } from './action-creators'
import { ConnectedUsername } from './connected-username'
import { ALL_USER_PROFILE_SUB_PAGES, UserProfileSubPage } from './user-profile-sub-page'

/**
 * One ranked mode the user has played this season: their division in it (undefined while the
 * season, which a division is placed against, isn't known), their main race in it (see
 * {@link getMainRace}), their raw point total, and record.
 */
export interface RankedMode {
  type: MatchmakingType
  division: MatchmakingDivision | undefined
  race: RaceChar | undefined
  points: number
  wins: number
  losses: number
}

/**
 * Returns the ranked modes the user has played at least {@link NUM_PLACEMENT_MATCHES} games of this
 * season, most-played first. A mode with fewer games was more likely tried once than actually
 * played, and its rank says little about the user.
 */
export function getRankedModes(
  profile: ReadonlyDeep<UserProfileJson>,
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined,
): RankedMode[] {
  const bonusPool = season ? getTotalBonusPoolForSeason(new Date(), season) : undefined
  return getRankedTypesByActivity(profile.ladder).flatMap((type): RankedMode[] => {
    const player = profile.ladder[type]!
    if (player.wins + player.losses < NUM_PLACEMENT_MATCHES) {
      return []
    }
    return [
      {
        type,
        division:
          bonusPool !== undefined
            ? ladderPlayerToMatchmakingDivision(player, bonusPool)
            : undefined,
        race: getMainRace(player),
        points: player.points,
        wins: player.wins,
        losses: player.losses,
      },
    ]
  })
}

/**
 * The share of a user's games one race (by selection, so Random counts as its own race) must
 * account for to be called their main race. Below it the user plays several races, and no single
 * one represents them.
 */
const MAIN_RACE_SHARE = 0.6

/**
 * Returns the race that accounts for at least {@link MAIN_RACE_SHARE} of the games in `stats`, or
 * undefined if none does (including when there are no games).
 */
export function getMainRace(stats: ReadonlyDeep<RaceStats>): RaceChar | undefined {
  const { pWins, pLosses, tWins, tLosses, zWins, zLosses, rWins, rLosses } = stats
  const totals: Array<[RaceChar, number]> = [
    ['p', pWins + pLosses],
    ['t', tWins + tLosses],
    ['z', zWins + zLosses],
    ['r', rWins + rLosses],
  ]
  const total = totals.reduce((sum, [, games]) => sum + games, 0)
  const [race, games] = totals.reduce((best, entry) => (entry[1] > best[1] ? entry : best))
  return total > 0 && games / total >= MAIN_RACE_SHARE ? race : undefined
}

/** How many of the most-played modes the card shows; the rest are left to the profile. */
const SHOWN_MODE_COUNT = 2

// Backdrops

const backdropLayer = css`
  position: absolute;
  inset: 0;
  z-index: -2;
  overflow: hidden;
  pointer-events: none;

  transition: transform 600ms cubic-bezier(0.2, 0, 0, 1);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const RaceBackdropRoot = styled.div<{ $race: RaceChar | undefined }>`
  ${backdropLayer};
  color: ${props => (props.$race ? getRaceColor(props.$race) : 'var(--theme-on-surface-variant)')};
  background: linear-gradient(
    100deg,
    color-mix(in srgb, currentColor 36%, transparent) 0%,
    color-mix(in srgb, currentColor 12%, transparent) 55%,
    transparent 100%
  );
`

const RaceBackdropIcon = styled(RaceIcon)`
  position: absolute;
  right: -12px;
  top: 50%;
  width: 180px;
  height: 180px;

  opacity: 0.45;
  filter: blur(2px);
  transform: translateY(-50%) rotate(-12deg);
`

/**
 * What's drawn behind the card, under its scrim: a wash of the user's most-played race, with that
 * race's emblem oversized behind them.
 */
function RaceBackdrop({ race }: { race: RaceChar | undefined }) {
  return (
    <RaceBackdropRoot $race={race}>
      {race ? <RaceBackdropIcon race={race} /> : null}
    </RaceBackdropRoot>
  )
}

// Shared pieces

const UserCardRoot = styled(BackdropCard)`
  &:hover ${RaceBackdropRoot} {
    transform: scale(1.08);
  }
`

const shadowedText = css`
  ${backdropTextShadow};
`

const NameText = styled(ConnectedUsername)`
  ${titleMedium};
  ${singleLine};
  ${shadowedText};
  min-width: 0;
  color: var(--theme-on-surface);
`

/**
 * The card's header: the season its ranks are from (or a plain title while the season is unknown),
 * then how long ago the user joined, with the exact date in a tooltip.
 */
function UserCardHeader({
  user,
  season,
}: {
  user: ReadonlyDeep<SbUser> | undefined
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined
}) {
  const { t } = useTranslation()
  return (
    <BackdropCardHeader>
      <BackdropCardTitle text={season?.name ?? t('users.card.title', 'Player')} />
      <BackdropCardMeta>
        {user ? (
          <BackdropCardMetaText
            text={t('users.card.joined', 'Joined {{time}}', {
              time: narrowDuration.format(user.created),
            })}
            tooltip={longTimestamp.format(user.created)}
          />
        ) : null}
      </BackdropCardMeta>
    </BackdropCardHeader>
  )
}

const RecordTotal = styled.span`
  ${singleLine};
  min-width: 0;
`

const RecordRoot = styled.div`
  ${bodySmall};
  ${shadowedText};
  height: 16px;
  min-width: 0;

  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;

  color: var(--theme-on-surface-variant);
`

const RecordCount = styled.span`
  flex-shrink: 0;
  margin-right: 8px;
  color: var(--theme-on-surface);
`

const RecordChip = styled(PlayerResultChip)`
  text-shadow: none;
`

/** The user's all-time win/loss record across every game they've played. */
function UserRecord({ profile }: { profile: ReadonlyDeep<UserProfileJson> }) {
  const { t } = useTranslation()
  const { pWins, tWins, zWins, rWins, pLosses, tLosses, zLosses, rLosses } = profile.userStats
  const wins = pWins + tWins + zWins + rWins
  const losses = pLosses + tLosses + zLosses + rLosses
  const total = wins + losses

  if (!total) {
    return <RecordRoot>{t('users.card.noGames', 'No games played')}</RecordRoot>
  }

  return (
    <RecordRoot>
      {(['win', 'loss'] as const).map(result => (
        <Fragment key={result}>
          <CardTooltip text={getResultLabel(result, t)} position='top'>
            <RecordChip $result={result} role='img' aria-label={getResultLabel(result, t)}>
              {getResultShortLabel(result, t)}
            </RecordChip>
          </CardTooltip>
          <RecordCount>{(result === 'win' ? wins : losses).toLocaleString()}</RecordCount>
        </Fragment>
      ))}
      <RecordTotal>
        {t('users.card.gameCount', {
          defaultValue: '{{total}} games',
          defaultValue_one: '{{total}} game',
          count: total,
          total: total.toLocaleString(),
        })}
      </RecordTotal>
    </RecordRoot>
  )
}

/**
 * The tooltip for a mode's emblem: the division it names and the user's main race in the mode,
 * since the mode is already labeled on the card. Everything else about a mode lives on the user's
 * profile.
 */
function getModeTooltip(mode: RankedMode, t: TFunction): string {
  const division =
    mode.division !== undefined
      ? matchmakingDivisionToLabel(mode.division, t)
      : t('users.card.divisionUnknown', 'Division unknown')
  return mode.race ? `${division} · ${raceCharToLabel(mode.race, t)}` : division
}

/**
 * Stands in for a division emblem whose division isn't known yet, the same size as the emblem that
 * replaces it.
 */
const UnknownDivision = styled.div<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  flex-shrink: 0;

  border: 2px dashed var(--theme-outline);
  border-radius: 50%;
`

const ModeEmblemIcon = styled(DivisionIcon)<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  flex-shrink: 0;
`

function ModeEmblem({
  division,
  size,
}: {
  division: MatchmakingDivision | undefined
  size: number
}) {
  return division !== undefined ? (
    <ModeEmblemIcon division={division} size={size} $size={size} />
  ) : (
    <UnknownDivision $size={size} />
  )
}

// Body

const BODY_HEIGHT = 56
const EMBLEM_SIZE = 36

const BodyRoot = styled.div`
  height: ${BODY_HEIGHT}px;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 12px;
`

const BodyAvatar = styled(ConnectedAvatar)`
  width: ${BODY_HEIGHT}px;
  height: ${BODY_HEIGHT}px;
  flex-shrink: 0;
`

const Identity = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const NameLine = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 6px;
`

const NameRaceIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const EmblemRow = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const EmblemCell = styled.div`
  width: 60px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

const EmblemFrame = styled.div`
  position: relative;
  flex-shrink: 0;
`

const EmblemRaceIcon = styled(RaceIcon)`
  position: absolute;
  right: -6px;
  bottom: -2px;
  width: 16px;
  height: 16px;

  filter: drop-shadow(0 0 1px rgb(0 0 0)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.8));
`

const EmblemLabel = styled.div`
  ${titleTiny};
  ${singleLine};
  ${shadowedText};
  max-width: 100%;
  color: var(--theme-on-surface-variant);
`

/**
 * An emblem for each of the most-played ranked modes, each labeled with its mode. An emblem is
 * badged with the user's main race in its mode only where that differs from `mainRace`, the race
 * the whole card already shows.
 */
function EmblemColumns({
  modes,
  mainRace,
}: {
  modes: ReadonlyArray<RankedMode>
  mainRace: RaceChar | undefined
}) {
  const { t } = useTranslation()

  if (!modes.length) {
    return (
      <EmblemRow>
        <CardTooltip
          position='top'
          text={t('users.card.notEnoughRankedGames', 'Not enough ranked games this season')}>
          <EmblemCell>
            <ModeEmblem division={MatchmakingDivision.Unrated} size={EMBLEM_SIZE} />
            <EmblemLabel>{t('users.card.unranked', 'Unranked')}</EmblemLabel>
          </EmblemCell>
        </CardTooltip>
      </EmblemRow>
    )
  }

  return (
    <EmblemRow>
      {modes.slice(0, SHOWN_MODE_COUNT).map(mode => (
        <CardTooltip key={mode.type} position='top' text={getModeTooltip(mode, t)}>
          <EmblemCell>
            <EmblemFrame>
              <ModeEmblem division={mode.division} size={EMBLEM_SIZE} />
              {mode.race && mode.race !== mainRace ? <EmblemRaceIcon race={mode.race} /> : null}
            </EmblemFrame>
            <EmblemLabel>{matchmakingTypeToLabel(mode.type, t)}</EmblemLabel>
          </EmblemCell>
        </CardTooltip>
      ))}
    </EmblemRow>
  )
}

function UserCardBody({
  userId,
  profile,
  modes,
  race,
}: {
  userId: SbUserId
  profile: ReadonlyDeep<UserProfileJson>
  modes: ReadonlyArray<RankedMode>
  /** The user's most-played race, if any. */
  race: RaceChar | undefined
}) {
  return (
    <BodyRoot>
      <BodyAvatar userId={userId} />
      <Identity>
        <NameLine>
          {race ? <NameRaceIcon race={race} /> : null}
          <CardClickBoundary>
            <NameText userId={userId} showTooltipForOverflow='top' />
          </CardClickBoundary>
        </NameLine>
        <UserRecord profile={profile} />
      </Identity>
      <EmblemColumns modes={modes} mainRace={race} />
    </BodyRoot>
  )
}

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
  /** The user, when the client knows them. */
  user: ReadonlyDeep<SbUser> | undefined
  state: UserCardState
  onProfileClick: () => void
}

/**
 * The presentational part of {@link UserCard}: renders the loading/error/loaded states without
 * fetching anything itself, so it can be driven directly (e.g. from a devonly test page).
 *
 * The loading state renders a placeholder the same height as the loaded card, so the message it's
 * attached to doesn't grow once the profile arrives; the error state collapses to a single line,
 * which only ever shrinks the card (growth is what breaks the message list's autoscroll).
 */
export function UserCardContent({ userId, user, state, onProfileClick }: UserCardContentProps) {
  const { t } = useTranslation()
  const height = getBackdropCardHeight(BODY_HEIGHT)

  if (state.status === 'loading') {
    return <BackdropCardLoading $height={height} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return (
      <BackdropCardGone>
        {t('users.card.loadError', "Couldn't load this user's profile.")}
      </BackdropCardGone>
    )
  }

  const { profile, season } = state
  const modes = getRankedModes(profile, season)
  const race = getMainRace(profile.userStats)

  return (
    <UserCardRoot
      imageUrl={undefined}
      height={height}
      onClick={onProfileClick}
      actionLabel={t('users.card.openProfile', 'View profile')}
      testName='user-card-profile-button'>
      <RaceBackdrop race={race} />
      <UserCardHeader user={user} season={season} />
      <UserCardBody userId={userId} profile={profile} modes={modes} race={race} />
    </UserCardRoot>
  )
}

/**
 * A compact card for a user, the whole of which opens their profile: their avatar, name, a division
 * emblem for each of their most-played ranked modes this season, and their overall win/loss
 * record. Fetches the profile itself, so it can be rendered for any user id; a profile loaded by an
 * earlier view is shown immediately while the fetch refreshes it.
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
      user={user}
      state={state}
      onProfileClick={() => navigateToUserProfile(userId, user?.name ?? '')}
    />
  )
}

/** The user a chat message link points at, and the profile tab it links to (if any). */
export interface UserLinkTarget {
  userId: SbUserId
  subPage: UserProfileSubPage | undefined
}

/**
 * Returns the user a profile page path (`/users/<id>/<name>` or `/users/<id>/<name>/<subPage>`)
 * points at, or undefined if the path isn't a profile path or its id segment isn't a user id.
 */
export function userFromProfilePath(pathname: string): UserLinkTarget | undefined {
  const segments = pathname.split('/').filter(segment => segment.length > 0)
  if (segments.length < 3 || segments.length > 4 || segments[0] !== 'users') {
    return undefined
  }

  if (!/^[1-9]\d*$/.test(segments[1])) {
    return undefined
  }

  const subPage = ALL_USER_PROFILE_SUB_PAGES.includes(segments[3] as UserProfileSubPage)
    ? (segments[3] as UserProfileSubPage)
    : undefined
  return { userId: makeSbUserId(Number(segments[1])), subPage }
}

/**
 * Returns the user a chat message link points at, or undefined if the link isn't a ShieldBattery
 * profile link (an external URL, or a ShieldBattery URL for something other than a profile).
 */
export function userFromMessageLink(href: string): UserLinkTarget | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  return isShieldBatteryUrl(url) ? userFromProfilePath(url.pathname) : undefined
}

/**
 * Why a user link card has nothing to show: the user doesn't exist, or their profile couldn't be
 * loaded right now (a transient failure, or the fetch budget below was spent).
 */
type UserLinkFailure = 'notFound' | 'error'

/**
 * Profile fetches for user link cards that are in flight, plus users known not to exist. Loaded
 * profiles aren't kept here: they land in the Redux store, which every card reads from first.
 */
const userLinkFetches = new Map<SbUserId, Promise<UserLinkFailure | undefined>>()

/**
 * How many profile fetches rendered profile links may start per window. Message text is
 * sender-controlled, so a history page full of distinct profile links must not be able to fan out
 * one request each against the profile endpoint's per-user throttle, which also serves the viewer's
 * own browsing of profiles. The budget covers a realistically link-heavy channel in one window
 * while leaving most of that throttle for direct views.
 */
const PROFILE_FETCH_BUDGET = 10
const PROFILE_FETCH_BUDGET_WINDOW_MS = 30 * 1000

let budgetWindowStart = 0
let budgetUsed = 0

function takeProfileFetchBudget(now: number): boolean {
  if (now - budgetWindowStart >= PROFILE_FETCH_BUDGET_WINDOW_MS) {
    budgetWindowStart = now
    budgetUsed = 0
  }
  if (budgetUsed >= PROFILE_FETCH_BUDGET) {
    return false
  }
  budgetUsed += 1
  return true
}

/**
 * Loads a user's profile into the Redux store for a user link card, resolving to why it couldn't
 * be, or undefined once it has been. Every card for the same user shares one fetch. A 404 stays
 * cached, since a user that doesn't exist never will; any other failure is evicted so a later card
 * retries.
 */
function loadProfileForLink(userId: SbUserId): Promise<UserLinkFailure | undefined> {
  const existing = userLinkFetches.get(userId)
  if (existing) {
    return existing
  }

  if (!takeProfileFetchBudget(Date.now())) {
    // Not cached, so a denied card that remounts (e.g. its channel is reopened) tries again against
    // whatever budget exists then. Until then it renders nothing, while its message's inline link
    // keeps working.
    return Promise.resolve('error')
  }

  const promise = fetchJson<GetUserProfileResponse>(apiUrl`users/${userId}/profile`).then(
    (payload): UserLinkFailure | undefined => {
      userLinkFetches.delete(userId)
      globalDispatch({ type: '@users/getUserProfile', payload })
      return undefined
    },
    (err): UserLinkFailure => {
      if (isFetchError(err) && err.status === 404) {
        return 'notFound'
      }
      userLinkFetches.delete(userId)
      return 'error'
    },
  )
  userLinkFetches.set(userId, promise)
  return promise
}

/**
 * A user card for a profile link posted in chat, the whole of which opens the profile (on the tab
 * the link points at). A profile already in the store is shown as it is, with no fetch: unlike the
 * card a command answers with, one link can render in many messages at once, so it only loads what
 * the store is missing (see {@link loadProfileForLink}).
 *
 * The error state renders nothing: the inline link in the message text still works, and shrinking
 * away is safe (only growth breaks the message list's autoscroll).
 */
export function UserLinkCard({ target }: { target: UserLinkTarget }) {
  const { t } = useTranslation()
  const { userId, subPage } = target
  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))
  const season = useAppSelector(s =>
    profile ? s.matchmakingSeasons.byId.get(profile.seasonId) : undefined,
  )
  const hasProfile = profile !== undefined
  // How this card's own fetch ended, for the user it was made for.
  const [settled, setSettled] = useState<{
    userId: SbUserId
    failure: UserLinkFailure | undefined
  }>()

  useEffect(() => {
    if (hasProfile) {
      return undefined
    }

    // The fetch is shared across every card showing this user, so it can't be aborted just because
    // this card goes away -- only ignore a result that arrives after that happens.
    let canceled = false
    loadProfileForLink(userId)
      .then(failure => {
        if (!canceled) {
          setSettled({ userId, failure })
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      canceled = true
    }
  }, [userId, hasProfile])

  const failure = !profile && settled?.userId === userId ? settled.failure : undefined
  if (failure === 'error') {
    return null
  }
  if (failure === 'notFound') {
    return (
      <BackdropCardGone>
        {t('users.card.notFound', 'This user could not be found.')}
      </BackdropCardGone>
    )
  }

  return (
    <UserCardContent
      userId={userId}
      user={user}
      state={profile ? { status: 'loaded', profile, season } : { status: 'loading' }}
      onProfileClick={() => navigateToUserProfile(userId, user?.name ?? '', subPage)}
    />
  )
}
