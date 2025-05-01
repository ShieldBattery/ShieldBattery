import {
  AnimatePresence,
  AnimationDefinition,
  MotionValue,
  Transition,
  useAnimate,
  useMotionValue,
  useTransform,
  Variants,
} from 'motion/react'
import * as m from 'motion/react-m'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { LeagueJson } from '../../common/leagues/leagues'
import {
  getDivisionColor,
  getDivisionsForPointsChange,
  getTotalBonusPoolForSeason,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingDivisionWithBounds,
  MatchmakingSeasonJson,
  NUM_PLACEMENT_MATCHES,
  POINTS_FOR_RATING_TARGET_FACTOR,
  PublicMatchmakingRatingChangeJson,
} from '../../common/matchmaking'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { PostMatchDialogPayload } from '../dialogs/dialog-type'
import { searchAgainFromGame } from '../games/action-creators'
import { MaterialIcon } from '../icons/material/material-icon'
import SearchAgainIcon from '../icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { LeagueBadge } from '../leagues/league-badge'
import logger from '../logging/logger'
import { FilledButton } from '../material/button'
import { Body, Dialog } from '../material/dialog'
import { GradientScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { Tooltip } from '../material/tooltip'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { startReplay } from '../replays/action-creators'
import { headlineMedium, labelMedium, singleLine, titleLarge } from '../styles/typography'
import { DivisionIcon } from './rank-icon'

const StyledDialog = styled(Dialog)<{ $hasLeagues?: boolean }>`
  max-width: ${props => (props.$hasLeagues ? '632px' : '432px')};
  --sb-post-match-delta-gap: ${props => (props.$hasLeagues ? '8px' : '16px')};
  --sb-post-match-points-bar-width: ${props => (props.$hasLeagues ? '368px' : '100%')};

  & ${Body} {
    overflow-x: hidden;
  }
`

const Content = styled.div`
  display: flex;
`

const SideOverline = styled.div`
  ${labelMedium};
  ${singleLine};
  text-align: center;
  overflow-x: hidden;
`
const MatchmakingSide = styled.div`
  width: 384px;

  & ${SideOverline} {
    width: 176px;
  }
`

const LeagueSide = styled.div`
  width: 200px;
`

const IconAndDeltas = styled.div`
  display: flex;
  gap: var(--sb-post-match-delta-gap);
  align-items: center;
  padding-top: 8px;
`

const Deltas = styled(m.div)`
  max-width: 208px;
  padding-bottom: 36px;
  display: flex;
  flex-direction: column;
`

const Leagues = styled.div`
  position: relative;
  height: 204px;
  margin-top: 8px;

  display: flex;
  flex-direction: column;
  justify-content: center;

  /* left divider */
  &::after {
    position: absolute;
    width: 1px;
    height: 192px;
    left: 0;
    top: 4px;
    content: '';
    background-color: var(--theme-outline-variant);
    z-index: 20;
  }
`

const LeaguesScrollable = styled(m.div)<{ $needsScroll: boolean }>`
  position: relative;
  padding: 4px 8px 32px 35px;
  overflow-y: ${props => (props.$needsScroll ? 'auto' : 'hidden')};
`

const LeagueTooltip = styled(Tooltip)`
  & + & {
    margin-top: 16px;
  }
`

const ButtonBar = styled.div`
  margin-bottom: -8px;
  padding-top: 24px;
  display: flex;
  gap: 16px;
  justify-content: center;
  align-items: center;
`

const SizedSearchAgainIcon = styled(SearchAgainIcon)`
  width: 24px;
  height: auto;
`

type PostMatchDialogProps = CommonDialogProps & ReadonlyDeep<PostMatchDialogPayload['initData']>

export function PostMatchDialog({
  onCancel,
  game,
  mmrChange,
  leagueChanges,
  leagues,
  replayPath,
  season,
}: PostMatchDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const onSearchAgain = useStableCallback(() => {
    dispatch(searchAgainFromGame(game.config))
    onCancel()
  })
  const onWatchReplay = useStableCallback(() => {
    if (replayPath) {
      dispatch(startReplay({ path: replayPath }))
    }
  })
  const canSearchMatchmaking = useAppSelector(s => {
    const isSearching = !!s.matchmaking.searchInfo
    return !isSearching
  })

  const leagueValues = useMemo(() => {
    const leagueById = new Map(leagues.map(l => [l.id, l]))
    const result = []
    for (const change of leagueChanges) {
      const league = leagueById.get(change.leagueId)
      if (!league) {
        continue
      }

      result.push({
        league,
        value: change.pointsChange,
      })
    }

    result.sort((a, b) => a.league.startAt - b.league.startAt)

    return result
  }, [leagueChanges, leagues])

  return (
    <StyledDialog
      showCloseButton={true}
      title={t('matchmaking.postMatchDialog.title', 'Match results')}
      onCancel={onCancel}
      $hasLeagues={leagueValues.length > 0}>
      <RatedUserContent mmrChange={mmrChange} leagueValues={leagueValues} season={season} />
      <ButtonBar>
        <FilledButton
          label={t('matchmaking.postMatchDialog.searchAgain', 'Search again')}
          iconStart={<SizedSearchAgainIcon />}
          onClick={onSearchAgain}
          disabled={!canSearchMatchmaking}
        />
        <FilledButton
          label={t('matchmaking.postMatchDialog.watchReplay', 'Watch replay')}
          iconStart={<MaterialIcon icon='videocam' />}
          onClick={onWatchReplay}
          disabled={!replayPath}
        />
      </ButtonBar>
    </StyledDialog>
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
  width: 176px;
  height: 212px;
`

function RatedUserContent({
  season,
  mmrChange,
  leagueValues,
}: {
  season: ReadonlyDeep<MatchmakingSeasonJson>
  mmrChange: ReadonlyDeep<PublicMatchmakingRatingChangeJson>
  leagueValues: ReadonlyArray<{ league: ReadonlyDeep<LeagueJson>; value: number }>
}) {
  const { t } = useTranslation()
  const divisionTransitions = useMemo(() => {
    const bonusPool = getTotalBonusPoolForSeason(new Date(), season)
    const startingPoints = mmrChange.points - mmrChange.pointsChange
    const divisions = getDivisionsForPointsChange(startingPoints, mmrChange.points, bonusPool)

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
  }, [mmrChange, season])
  const [divisionIndex, setDivisionIndex] = useState(0)

  const deltaValues = useMemo(
    () =>
      mmrChange.lifetimeGames >= NUM_PLACEMENT_MATCHES
        ? [
            {
              label: t('matchmaking.postMatchDialog.points', 'Points'),
              value: mmrChange.pointsChange,
            },
            {
              label: t('matchmaking.postMatchDialog.rating', 'Rating'),
              value: mmrChange.ratingChange,
            },
          ]
        : [
            {
              label: t('matchmaking.postMatchDialog.points', 'Points'),
              value: mmrChange.pointsChange,
            },
          ],
    [mmrChange.lifetimeGames, mmrChange.pointsChange, mmrChange.ratingChange, t],
  )

  const lastPointRevealSoundRef = useRef(0)
  const playPointRevealSound = useCallback((...args: any[]) => {
    // Debounce playing this sound so things like Leagues that start a bunch of animations at once
    // don't play a super loud version of this sound :)
    const now = window.performance.now()
    if (now - lastPointRevealSoundRef.current > 50) {
      audioManager.playSound(AvailableSound.PointReveal)
      lastPointRevealSoundRef.current = now
    }
  }, [])

  const scoreSoundRef = useRef<AudioBufferSourceNode>(undefined)

  const [pointsAnimScope, pointsAnimate] = useAnimate()
  const [animatingPoints, setAnimatingPoints] = useState(false)
  const points = useMotionValue(divisionTransitions[0].from)
  const divPercent = useMotionValue(
    calculateDivisionPercent(
      divisionTransitions[0].divisionWithBounds,
      divisionTransitions[0].from,
    ),
  )

  const maybeBeginPointsAnimation = useCallback((latest: AnimationDefinition) => {
    if (latest === 'animate') {
      setAnimatingPoints(true)
    }
  }, [])

  const currentTransition =
    divisionTransitions.length > divisionIndex ? divisionTransitions[divisionIndex] : undefined
  useEffect(() => {
    if (!animatingPoints || !currentTransition) {
      return () => {}
    }

    Promise.resolve()
      .then(async () => {
        const { divisionWithBounds, from, to } = currentTransition
        const startPercent = calculateDivisionPercent(divisionWithBounds, from)
        const endPercent = calculateDivisionPercent(divisionWithBounds, to)

        // Wait for division icon change animation to complete
        await pointsAnimate(0, 1, { duration: divisionIndex > 0 ? 0.75 : 0.25 })

        scoreSoundRef.current?.stop()
        if (Math.round(Math.abs(to - from)) >= 1) {
          scoreSoundRef.current = audioManager.playSound(AvailableSound.ScoreCount, {
            loop: true,
          })
        }

        const minPointAnimationTime = 0.75
        const maxPointAnimationTime = 3
        const pointAnimationTime = Math.max(
          minPointAnimationTime,
          Math.abs(endPercent - startPercent) * maxPointAnimationTime,
        )

        try {
          await Promise.all([
            pointsAnimate(startPercent, endPercent, {
              ease: 'easeInOut',
              duration: pointAnimationTime,
              onUpdate: p => divPercent.set(p),
            }),
            pointsAnimate(from, to, {
              ease: 'easeInOut',
              duration: pointAnimationTime,
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
  ])

  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  const deltaDelay = 0.5
  const deltaStagger = 0.75
  const leagueDelay = deltaDelay + deltaStagger * deltaValues.length

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
    <Content>
      <MatchmakingSide style={{ '--sb-points-bar-bg': pointsBarBackground } as any}>
        <SideOverline>{t('matchmaking.postMatchDialog.matchmaking', 'Matchmaking')}</SideOverline>
        <IconAndDeltas>
          <DivisionIconContainer>
            <AnimatePresence mode='wait'>
              <IconWithLabel
                key={divisionWithBounds[0]}
                division={divisionWithBounds[0]}
                noInitialAnim={divisionIndex === 0}
              />
            </AnimatePresence>
          </DivisionIconContainer>
          <Deltas
            variants={{
              initial: {},
              animate: { transition: { delayChildren: deltaDelay, staggerChildren: deltaStagger } },
            }}
            initial='initial'
            animate='animate'
            onAnimationComplete={leagueValues.length === 0 ? maybeBeginPointsAnimation : undefined}>
            {deltaValues.map(item => (
              <DeltaItem
                key={item.label}
                label={item.label}
                value={item.value}
                playSound={playPointRevealSound}
              />
            ))}
          </Deltas>
        </IconAndDeltas>
        <PointsBarView
          points={points}
          ref={pointsAnimScope}
          style={{ '--sb-points-bar-scale': divPercent } as any}
        />
      </MatchmakingSide>
      {leagueValues.length > 0 ? (
        <LeagueSide>
          <SideOverline>{t('matchmaking.postMatchDialog.leagues', 'Leagues')}</SideOverline>
          <Leagues>
            <GradientScrollDivider $showAt='top' $heightPx={32} $show={!isAtTop} />
            <LeaguesScrollable
              $needsScroll={!isAtTop || !isAtBottom}
              variants={{
                initial: { overflow: 'hidden' },
                animate: {
                  overflow: '',
                  transition: { when: 'afterChildren', delayChildren: leagueDelay },
                },
              }}
              initial='initial'
              animate='animate'
              onAnimationComplete={maybeBeginPointsAnimation}>
              {topElem}
              {leagueValues.map(item => (
                <LeagueTooltip key={item.league.id} text={item.league.name} position={'left'}>
                  <LeagueDelta {...item} playSound={playPointRevealSound} />
                </LeagueTooltip>
              ))}
              {bottomElem}
            </LeaguesScrollable>
            <GradientScrollDivider $showAt='bottom' $heightPx={32} $show={!isAtBottom} />
          </Leagues>
        </LeagueSide>
      ) : undefined}
    </Content>
  )
}

const DeltaItemRoot = styled(m.div)`
  ${headlineMedium};
  display: flex;
  align-items: baseline;
  gap: 8px;

  & + & {
    margin-top: 16px;
  }
`

const DeltaValue = styled.div`
  width: 104px;
  flex-grow: 0;
  color: var(--theme-on-surface);
  text-align: right;
`

const DeltaLabel = styled.div`
  ${titleLarge};
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
  playSound,
}: {
  label: string
  value: number
  playSound: () => void
}) {
  const roundedValue = Math.round(value)
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
      <DeltaValue>
        {roundedValue < 0 ? '' : '+'}
        {roundedValue}
      </DeltaValue>
      <DeltaLabel>{label}</DeltaLabel>
    </DeltaItemRoot>
  )
}

const LeagueDeltaRoot = styled(m.div)`
  ${titleLarge};
  display: flex;
  align-items: center;
  gap: 16px;
`

function LeagueDelta({
  league,
  value,
  playSound,
}: {
  league: ReadonlyDeep<LeagueJson>
  value: number
  playSound: () => void
}) {
  const roundedValue = Math.round(value)
  const hasPlayedSound = useRef(false)

  return (
    <LeagueDeltaRoot
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
      <LeagueBadge league={league} />
      {roundedValue < 0 ? '' : '+'}
      {roundedValue}
    </LeagueDeltaRoot>
  )
}

const IconWithLabelElement = styled(m.div)`
  position: absolute;
  top: 0;
  left: 0;
`

const StyledDivisionIcon = styled(DivisionIcon)`
  width: 176px;
  height: 176px;

  filter: saturate(var(--_saturate, 100%)) brightness(var(--_brightness, 1)) blur(var(--_blur, 0));
`

const RankLabel = styled.div`
  ${titleLarge};
  ${singleLine};
  padding-top: 8px;
  text-align: center;
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
      <StyledDivisionIcon division={division} size={176} />
      <RankLabel>{matchmakingDivisionToLabel(division, t)}</RankLabel>
    </IconWithLabelElement>
  )
}

const PointsBarRoot = styled(m.div)`
  position: relative;
  width: var(--sb-post-match-points-bar-width);
  height: 72px;
  padding: 32px 0 24px;
  overflow-x: visible;
`

const PointsBar = styled.div`
  position: relative;
  width: 100%;
  height: 20px;

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

const PointsLabelMover = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 52px;

  transform: translateX(calc(var(--sb-points-bar-scale, 0) * 100%));
`

const PointsLabel = styled(m.div)`
  ${labelMedium};
  position: absolute;
  transform: translateX(-50%); // Center the text on the left edge of the box that we move (above)
`

interface PointsBarViewProps {
  points: MotionValue<number>
}

const PointsBarView = m.create(
  React.forwardRef<HTMLDivElement, PointsBarViewProps>(({ points }, ref) => {
    const roundedPoints = useTransform(() => Math.round(points.get()))

    return (
      <PointsBarRoot ref={ref}>
        <PointsBar />
        <PointsLabelMover>
          <PointsLabel>{roundedPoints}</PointsLabel>
        </PointsLabelMover>
      </PointsBarRoot>
    )
  }),
)
