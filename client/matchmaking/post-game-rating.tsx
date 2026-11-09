import { useSetAtom } from 'jotai'
import {
  AnimatePresence,
  AnimationDefinition,
  MotionValue,
  Transition,
  useAnimate,
  useMotionValue,
  usePageInView,
  useReducedMotion,
  useTransform,
  Variants,
} from 'motion/react'
import * as m from 'motion/react-m'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import {
  ClientLeagueUserChangeJson,
  GameLeagueRankChange,
  LeagueJson,
} from '../../common/leagues/leagues'
import {
  getDivisionColor,
  getDivisionContext,
  getDivisionsForPointsChange,
  isSoloType,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingDivisionWithBounds,
  MatchmakingSeasonJson,
  NUM_PLACEMENT_MATCHES,
  POINTS_FOR_RATING_TARGET_FACTOR,
  PublicMatchmakingRatingChangeJson,
} from '../../common/matchmaking'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { markPostGameResultsRevealedAtom } from '../games/game-atoms'
import { MaterialIcon } from '../icons/material/material-icon'
import { LeagueBadge } from '../leagues/league-badge'
import { useLocalizedLeague } from '../leagues/use-localized-league'
import logger from '../logging/logger'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodySmall, labelMedium, titleMedium } from '../styles/typography'
import { DivisionIcon } from './rank-icon'

const Root = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  width: 100%;
  max-width: 380px;
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`
const CardTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`
const SeasonName = styled.div`
  ${bodySmall};
  margin-top: 2px;
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`
const MainSection = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  min-width: 0;
`
const Deltas = styled(m.div)`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 12px;

  @container (max-width: 880px) {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 16px 32px;
  }
`
const PlacementLabel = styled.div`
  ${bodySmall};
  margin-top: 12px;
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`
const Leagues = styled(m.div)`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--theme-outline-variant);
`
const LeagueHeading = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

export interface PostGameRatingProps {
  gameId: string
  mmrChange: ReadonlyDeep<PublicMatchmakingRatingChangeJson>
  leagueChanges: ReadonlyDeep<ClientLeagueUserChangeJson[]>
  leagueStandings?: ReadonlyArray<GameLeagueRankChange>
  leagues: ReadonlyDeep<LeagueJson[]>
  season: ReadonlyDeep<MatchmakingSeasonJson>
  /** Whether the reveal has already played, so these results should just be shown as they are. */
  revealed: boolean
}

/**
 * Shows how a matchmaking game moved a player's division, points, rating and leagues, revealing
 * the changes one by one the first time they're shown.
 */
export function PostGameRating({
  gameId,
  mmrChange,
  leagueChanges,
  leagueStandings,
  leagues,
  season,
  revealed,
}: PostGameRatingProps) {
  const markRevealed = useSetAtom(markPostGameResultsRevealedAtom)
  const reducedMotion = useReducedMotion()
  const [animate] = useState(!revealed && !reducedMotion)

  useEffect(() => {
    markRevealed(gameId)
  }, [gameId, markRevealed])

  const leagueValues = useMemo(() => {
    const leagueById = new Map(leagues.map(l => [l.id, l]))
    const standingByLeague = new Map(
      leagueStandings?.map(standing => [standing.leagueId, standing]),
    )
    const result = []
    for (const change of leagueChanges) {
      const league = leagueById.get(change.leagueId)
      if (!league) {
        continue
      }

      result.push({
        league,
        value: change.pointsChange,
        standing: standingByLeague.get(change.leagueId),
      })
    }

    result.sort((a, b) => a.league.startAt - b.league.startAt)

    return result
  }, [leagueChanges, leagueStandings, leagues])

  return (
    <Root>
      <RatedUserContent
        mmrChange={mmrChange}
        leagueValues={leagueValues}
        season={season}
        animate={animate}
      />
    </Root>
  )
}

function calculateDivisionPercent(
  divisionWithBounds: Readonly<MatchmakingDivisionWithBounds>,
  points: number,
) {
  const [division, _low, _high] = divisionWithBounds
  const low = Math.max(0, _low)
  const high =
    division === MatchmakingDivision.Champion
      ? // Champion runs forever, but that doesn't make for a particularly compelling bar, so we
        // pick a points that is finite but unlikely to be achieved.
        Math.max(points, 3000 * POINTS_FOR_RATING_TARGET_FACTOR)
      : _high
  return Math.min((points - low) / (high - low), 1)
}

const DivisionIconContainer = styled.div`
  position: relative;
  flex: 0 0 112px;
  width: 112px;
`

function RatedUserContent({
  season,
  mmrChange,
  leagueValues,
  animate,
}: {
  season: ReadonlyDeep<MatchmakingSeasonJson>
  mmrChange: ReadonlyDeep<PublicMatchmakingRatingChangeJson>
  leagueValues: ReadonlyArray<{
    league: ReadonlyDeep<LeagueJson>
    value: number
    standing?: GameLeagueRankChange
  }>
  animate: boolean
}) {
  const { t } = useTranslation()
  const pageInView = usePageInView()
  const [shownAt] = useState(() => new Date())
  const divisionTransitions = useMemo(() => {
    const startingPoints = mmrChange.points - mmrChange.pointsChange
    const divisions = getDivisionsForPointsChange(
      isSoloType(mmrChange.matchmakingType),
      startingPoints,
      mmrChange.points,
      getDivisionContext(shownAt, season),
    )

    const isNegative = mmrChange.pointsChange < 0

    return divisions.map((divisionWithBounds, i) => {
      const [div, low, high] = divisionWithBounds
      if (div === MatchmakingDivision.Unrated) {
        return { divisionWithBounds, from: low, to: high }
      }

      let from = isNegative ? high : low
      let to = isNegative ? low : high

      if (i === 0) {
        from = startingPoints
      }
      if (i === divisions.length - 1) {
        to = mmrChange.points
      }

      return { divisionWithBounds, from, to }
    })
  }, [mmrChange, season, shownAt])
  // Starting past the last transition leaves nothing to animate through.
  const [divisionIndex, setDivisionIndex] = useState(animate ? 0 : divisionTransitions.length)

  const deltaValues = useMemo(
    () =>
      mmrChange.lifetimeGames >= NUM_PLACEMENT_MATCHES
        ? [
            {
              label: t('matchmaking.postMatchDialog.points', 'Points'),
              value: mmrChange.pointsChange,
              total: mmrChange.points,
            },
            {
              label: t('matchmaking.postMatchDialog.mmr', 'MMR'),
              value: mmrChange.ratingChange,
              total: mmrChange.rating,
            },
          ]
        : [
            {
              label: t('matchmaking.postMatchDialog.points', 'Points'),
              value: mmrChange.pointsChange,
              total: mmrChange.points,
            },
          ],
    [
      mmrChange.lifetimeGames,
      mmrChange.points,
      mmrChange.pointsChange,
      mmrChange.rating,
      mmrChange.ratingChange,
      t,
    ],
  )

  const lastPointRevealSoundRef = useRef(0)
  const playPointRevealSound = useCallback(
    (...args: any[]) => {
      if (!animate) {
        return
      }
      // Debounce playing this sound so things like Leagues that start a bunch of animations at once
      // don't play a super loud version of this sound :)
      const now = window.performance.now()
      if (now - lastPointRevealSoundRef.current > 50) {
        audioManager.playSound(AvailableSound.PointReveal)
        lastPointRevealSoundRef.current = now
      }
    },
    [animate],
  )

  const scoreSoundRef = useRef<FadeableSound | undefined>(undefined)

  const [pointsAnimScope, pointsAnimate] = useAnimate()
  const [animatingPoints, setAnimatingPoints] = useState(false)
  const initialTransition = animate
    ? divisionTransitions[0]
    : divisionTransitions[divisionTransitions.length - 1]
  const initialPoints = animate ? initialTransition.from : initialTransition.to
  const points = useMotionValue(initialPoints)
  const divPercent = useMotionValue(
    calculateDivisionPercent(initialTransition.divisionWithBounds, initialPoints),
  )

  const maybeBeginPointsAnimation = useCallback((latest: AnimationDefinition) => {
    if (latest === 'animate') {
      setAnimatingPoints(true)
    }
  }, [])

  const currentTransition =
    divisionTransitions.length > divisionIndex ? divisionTransitions[divisionIndex] : undefined
  useEffect(() => {
    if (!animatingPoints || !currentTransition || !pageInView) {
      return () => {}
    }

    let canceled = false

    Promise.resolve()
      .then(async () => {
        const { divisionWithBounds, from, to } = currentTransition
        const startPercent = calculateDivisionPercent(divisionWithBounds, from)
        const endPercent = calculateDivisionPercent(divisionWithBounds, to)

        // Wait for division icon change animation to complete
        await pointsAnimate(0, 1, { duration: divisionIndex > 0 ? 0.75 : 0.25 })

        if (canceled) {
          return
        }

        const minPointAnimationTime = 0.75
        const maxPointAnimationTime = 3
        const pointAnimationTime = Math.max(
          minPointAnimationTime,
          Math.abs(endPercent - startPercent) * maxPointAnimationTime,
        )

        try {
          let playedSound: FadeableSound | undefined
          await Promise.all([
            pointsAnimate(startPercent, endPercent, {
              ease: 'easeInOut',
              duration: pointAnimationTime,
              onUpdate: p => divPercent.set(p),
            }),
            pointsAnimate(from, to, {
              ease: 'easeInOut',
              duration: pointAnimationTime,
              onPlay: () => {
                scoreSoundRef.current?.fadeOut(0.1)
                if (Math.round(Math.abs(to - from)) >= 1) {
                  playedSound = scoreSoundRef.current = audioManager.playFadeableSound(
                    AvailableSound.ScoreCount,
                    {
                      loop: true,
                    },
                  )
                }
              },
              onComplete: () => {
                if (playedSound) {
                  playedSound.loop = false
                }
              },
              onStop: () => {
                if (playedSound) {
                  playedSound.loop = false
                }
              },
              onUpdate: p => points.set(p),
            }),
          ])
        } finally {
          if (scoreSoundRef.current) {
            scoreSoundRef.current.loop = false
          }
        }

        setDivisionIndex(i => i + 1)
      })
      .catch(err => logger.warning(`Error while animating points: ${getErrorStack(err)}`))

    return () => {
      canceled = true
      if (scoreSoundRef.current) {
        scoreSoundRef.current.loop = false
      }
    }
  }, [
    currentTransition,
    animatingPoints,
    points,
    pointsAnimate,
    divPercent,
    divisionTransitions,
    divisionIndex,
    pageInView,
  ])

  const deltaDelay = 0.5
  const deltaStagger = 0.75
  const leagueDelay = deltaDelay + deltaStagger * deltaValues.length
  const showStandingColumn = leagueValues.some(item => item.standing)

  const { divisionWithBounds } =
    divisionTransitions[Math.min(divisionIndex, divisionTransitions.length - 1)]
  const division = divisionWithBounds[0]

  const pointsBarBackground = useMemo(() => {
    const divColor = getDivisionColor(division)

    return `linear-gradient(to right,
        oklch(from ${divColor} calc(0.75 * l) calc(1.1 * c) h) 0%,
        ${divColor} 33%,
        ${divColor} 75%,
        oklch(from ${divColor} calc(l * 1.12) calc(1.25 * c) h) 94%,
        oklch(from ${divColor} calc(l * 1.2) calc(1.35 * c) h) 100%)`
  }, [division])

  return (
    <div style={{ '--sb-points-bar-bg': pointsBarBackground } as any}>
      <CardTitle>{t('gameDetails.debugInfo.reportedResult', 'Result')}</CardTitle>
      <SeasonName>{season.name}</SeasonName>
      <MainSection>
        <DivisionIconContainer>
          <AnimatePresence mode='wait'>
            <IconWithLabel
              key={division}
              division={division}
              noInitialAnim={!animate || divisionIndex === 0}
            />
          </AnimatePresence>
        </DivisionIconContainer>
        <Deltas
          variants={{
            initial: {},
            animate: { transition: { delayChildren: deltaDelay, staggerChildren: deltaStagger } },
          }}
          initial={animate ? 'initial' : false}
          animate='animate'
          onAnimationComplete={leagueValues.length === 0 ? maybeBeginPointsAnimation : undefined}>
          {deltaValues.map((item, i) => (
            <DeltaItem
              key={item.label}
              {...item}
              animatedTotal={i === 0 ? points : undefined}
              playSound={playPointRevealSound}
            />
          ))}
        </Deltas>
      </MainSection>
      {mmrChange.lifetimeGames < NUM_PLACEMENT_MATCHES ? (
        <PlacementLabel>
          {t(
            'matchmaking.postMatchDialog.placementsCompleted',
            'Placement matches completed: {{completed}} / {{total}}',
            {
              completed: mmrChange.lifetimeGames,
              total: NUM_PLACEMENT_MATCHES,
            },
          )}
        </PlacementLabel>
      ) : null}
      <PointsBarView divPercent={divPercent} ref={pointsAnimScope} />
      {leagueValues.length > 0 ? (
        <Leagues
          variants={{
            initial: {},
            animate: { transition: { when: 'afterChildren', delayChildren: leagueDelay } },
          }}
          initial={animate ? 'initial' : false}
          animate='animate'
          onAnimationComplete={maybeBeginPointsAnimation}>
          <LeagueHeading>{t('matchmaking.postMatchDialog.leagues', 'Leagues')}</LeagueHeading>
          {leagueValues.map(item => (
            <LeagueDelta
              key={item.league.id}
              {...item}
              showStandingColumn={showStandingColumn}
              playSound={playPointRevealSound}
            />
          ))}
        </Leagues>
      ) : null}
    </div>
  )
}

const DeltaItemRoot = styled(m.div)`
  min-width: 0;
`
const DeltaLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  overflow-wrap: anywhere;
`
const DeltaNumbers = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
`
const DeltaTotal = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface);
`
const DeltaValue = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const deltaVariants: Variants = {
  initial: { opacity: 0, y: 32 },
  animate: { opacity: 1, y: 0 },
}
const deltaTransition: Transition = {
  y: { type: 'spring', duration: 0.6, bounce: 0 },
  opacity: { type: 'spring', duration: 0.4, bounce: 0 },
}

function DeltaItem({
  label,
  value,
  total,
  animatedTotal,
  playSound,
}: {
  label: string
  value: number
  total: number
  animatedTotal?: MotionValue<number>
  playSound: () => void
}) {
  const roundedValue = Math.round(value)
  const displayTotal = useTransform(() => Math.round(animatedTotal?.get() ?? total))
  const hasPlayedSound = useRef(false)

  return (
    <DeltaItemRoot
      variants={deltaVariants}
      transition={deltaTransition}
      onUpdate={latest => {
        // NOTE(tec27): We can't use onAnimationStart here because it fires before the delay/stagger
        // has passed
        if (!hasPlayedSound.current && (latest.opacity as number) > 0) {
          playSound()
          hasPlayedSound.current = true
        }
      }}>
      <DeltaLabel>{label}</DeltaLabel>
      <DeltaNumbers>
        <DeltaTotal>
          <m.span>{displayTotal}</m.span>
        </DeltaTotal>
        <DeltaValue>
          {roundedValue < 0 ? '' : '+'}
          {roundedValue}
        </DeltaValue>
      </DeltaNumbers>
    </DeltaItemRoot>
  )
}

const LeagueDeltaRoot = styled(m.div)`
  ${labelMedium};
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`
const LeagueStandingColumn = styled.div`
  width: 48px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
`

const LeagueRankMovement = styled.span<{ $rose: boolean }>`
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  color: ${props => (props.$rose ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

function LeagueStanding({ standing }: { standing?: GameLeagueRankChange }) {
  if (!standing) {
    return <LeagueStandingColumn />
  }

  const { rankBefore, rankAfter } = standing
  const movement = rankBefore !== null ? rankBefore - rankAfter : 0
  const rank = `#${rankAfter}`
  const rankHistory = movement ? `#${rankBefore} → ${rank}` : rank

  return (
    <LeagueStandingColumn title={rankHistory}>
      <span>{rank}</span>
      {movement ? (
        <LeagueRankMovement $rose={movement > 0} role='img' aria-label={rankHistory}>
          <MaterialIcon icon={movement > 0 ? 'arrow_upward' : 'arrow_downward'} size={16} />
          {Math.abs(movement)}
        </LeagueRankMovement>
      ) : null}
    </LeagueStandingColumn>
  )
}

const StyledLeagueBadge = styled(LeagueBadge)`
  flex: none;
`
const LeagueName = styled.div`
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
`
const LeagueChange = styled.div`
  flex: none;
`

function LeagueDelta({
  league,
  value,
  standing,
  showStandingColumn,
  playSound,
}: {
  league: ReadonlyDeep<Pick<LeagueJson, 'name' | 'badgePath' | 'translations'>>
  value?: number
  standing?: GameLeagueRankChange
  showStandingColumn: boolean
  playSound?: () => void
}) {
  const { name } = useLocalizedLeague(league)
  const roundedValue = value !== undefined ? Math.round(value) : undefined
  const hasPlayedSound = useRef(false)

  return (
    <LeagueDeltaRoot
      variants={deltaVariants}
      transition={deltaTransition}
      onUpdate={latest => {
        // NOTE(tec27): We can't use onAnimationStart here because it fires before the delay/stagger
        // has passed
        if (!hasPlayedSound.current && (latest.opacity as number) > 0) {
          playSound?.()
          hasPlayedSound.current = true
        }
      }}>
      {showStandingColumn ? <LeagueStanding standing={standing} /> : null}
      <StyledLeagueBadge leagueName={name} badgeUrl={league.badgePath} />
      <LeagueName>{name}</LeagueName>
      {roundedValue !== undefined ? (
        <LeagueChange>
          {roundedValue < 0 ? '' : '+'}
          {roundedValue}
        </LeagueChange>
      ) : null}
    </LeagueDeltaRoot>
  )
}

/** Shows saved standings when the one-time match reveal is no longer available. */
export function PostGameLeagueStandings({
  standings,
}: {
  standings: ReadonlyArray<GameLeagueRankChange>
}) {
  const { t } = useTranslation()

  return (
    <Leagues>
      <LeagueHeading>{t('matchmaking.postMatchDialog.leagues', 'Leagues')}</LeagueHeading>
      {standings.map(standing => (
        <LeagueDelta
          key={standing.leagueId}
          league={{ name: standing.leagueName }}
          standing={standing}
          showStandingColumn={true}
        />
      ))}
    </Leagues>
  )
}

const IconWithLabelElement = styled(m.div)`
  width: 100%;
`

const StyledDivisionIcon = styled(DivisionIcon)`
  width: 112px;
  height: 112px;

  filter: saturate(var(--_saturate, 100%)) brightness(var(--_brightness, 1)) blur(var(--_blur, 0));
`

const RankLabel = styled.div`
  ${labelMedium};
  padding-top: 4px;
  text-align: center;
  overflow-wrap: anywhere;
`

const iconVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.1,
    '--_saturate': '225%',
    '--_brightness': 2,
    '--_blur': '8px',
  },
  animate: { opacity: 1, scale: 1, '--_saturate': '100%', '--_brightness': 1, '--_blur': '0px' },
  exit: { opacity: 0, scale: 0.6, transition: { type: 'spring', duration: 0.1, bounce: 0 } },
}

const iconTransition: Transition = {
  default: { type: 'spring', duration: 0.5, bounce: 0 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
  scale: { type: 'spring', visualDuration: 0.4, bounce: 0.3 },
}

function IconWithLabel({
  division,
  noInitialAnim,
}: {
  division: MatchmakingDivision
  noInitialAnim?: boolean
}) {
  const { t } = useTranslation()

  return (
    <IconWithLabelElement
      variants={iconVariants}
      transition={iconTransition}
      initial={noInitialAnim ? 'animate' : 'initial'}
      animate='animate'
      exit='exit'
      onAnimationStart={latest => {
        if (latest === 'animate' && !noInitialAnim) {
          audioManager.playSound(AvailableSound.RankUp, { when: 0.15 })
        }
      }}>
      <StyledDivisionIcon division={division} size={112} />
      <RankLabel>{matchmakingDivisionToLabel(division, t)}</RankLabel>
    </IconWithLabelElement>
  )
}

const PointsBarRoot = styled(m.div)`
  margin-top: 16px;
`
const PointsBar = styled.div`
  position: relative;
  width: 100%;
  height: 10px;

  background-color: var(--theme-container-lowest);
  border: 2px solid var(--theme-outline-variant);
  border-radius: 9999px;
  contain: paint;

  &::after {
    position: absolute;
    content: '';
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    background: var(--sb-points-bar-bg, currentColor);
    transform: translateX(calc(-100% + 100% * var(--sb-points-bar-scale, 0)));
    transform-origin: 100% 50%;
  }
`

interface PointsBarViewProps {
  divPercent: MotionValue<number>
  ref?: React.Ref<HTMLDivElement>
}

// NOTE: Keep this a plain component so motion passes the MotionValue to PointsBarRoot intact.
function PointsBarView({ divPercent, ref }: PointsBarViewProps) {
  return (
    <PointsBarRoot ref={ref} style={{ '--sb-points-bar-scale': divPercent } as any}>
      <PointsBar />
    </PointsBarRoot>
  )
}
