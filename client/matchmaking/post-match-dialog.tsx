import { darken, lighten, saturate } from 'polished'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { animated, useChain, useSpring, useSpringRef, useTransition } from 'react-spring'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { LeagueJson } from '../../common/leagues'
import {
  MatchmakingDivision,
  MatchmakingDivisionWithBounds,
  NUM_PLACEMENT_MATCHES,
  PublicMatchmakingRatingChangeJson,
  getDivisionColor,
  getDivisionsForRatingChange,
  matchmakingDivisionToLabel,
  ratingToMatchmakingDivisionAndBounds,
} from '../../common/matchmaking'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { PostMatchDialogPayload } from '../dialogs/dialog-type'
import { searchAgainFromGame } from '../games/action-creators'
import { MaterialIcon } from '../icons/material/material-icon'
import SearchAgainIcon from '../icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { LeagueBadge } from '../leagues/league-badge'
import { RaisedButton } from '../material/button'
import { Body, Dialog } from '../material/dialog'
import { GradientScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { defaultSpring } from '../material/springs'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { startReplayFromPath } from '../replays/action-creators'
import { useStableCallback } from '../state-hooks'
import { colorDividers, colorTextPrimary, colorTextSecondary } from '../styles/colors'
import {
  caption,
  headline4,
  headline5,
  headline6,
  overline,
  singleLine,
} from '../styles/typography'
import { DivisionIcon } from './rank-icon'

const StyledDialog = styled(Dialog)<{ $hasLeagues?: boolean }>`
  max-width: ${props => (props.$hasLeagues ? '632px' : '432px')};
  --sb-post-match-delta-gap: ${props => (props.$hasLeagues ? '8px' : '16px')};
  --sb-post-match-rating-bar-width: ${props => (props.$hasLeagues ? '368px' : '100%')};

  & ${Body} {
    overflow-x: hidden;
  }
`

const Content = styled.div`
  display: flex;
`

const SideOverline = styled.div`
  ${overline};
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

const Deltas = styled.div`
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
    background-color: ${colorDividers};
    z-index: 20;
  }
`

const LeaguesScrollable = styled.div<{ $needsScroll: boolean }>`
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

const AnimatedDeltaItem = animated(DeltaItem)
const AnimatedLeagueDelta = animated(LeagueDelta)

type PostMatchDialogProps = CommonDialogProps & ReadonlyDeep<PostMatchDialogPayload['initData']>

export function PostMatchDialog({
  dialogRef,
  onCancel,
  game,
  mmrChange,
  leagueChanges,
  leagues,
  replayPath,
}: PostMatchDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const onSearchAgain = useStableCallback(() => {
    dispatch(searchAgainFromGame(game.config))
    onCancel()
  })
  const onWatchReplay = useStableCallback(() => {
    if (replayPath) {
      dispatch(startReplayFromPath(replayPath))
    }
  })
  const canSearchMatchmaking = useAppSelector(s => {
    const currentParty = s.party.current
    const isSearching = !!s.matchmaking.searchInfo
    return !isSearching && (!currentParty || currentParty.leader === s.auth.user.id)
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
      dialogRef={dialogRef}
      showCloseButton={true}
      title={t('matchmaking.postMatchDialog.title', 'Match results')}
      onCancel={onCancel}
      $hasLeagues={leagueValues.length > 0}>
      {mmrChange.lifetimeGames >= NUM_PLACEMENT_MATCHES ? (
        <RatedUserContent mmrChange={mmrChange} leagueValues={leagueValues} />
      ) : (
        <UnratedUserContent mmrChange={mmrChange} leagueValues={leagueValues} />
      )}
      <ButtonBar>
        <RaisedButton
          label={t('matchmaking.postMatchDialog.searchAgain', 'Search again')}
          iconStart={<SizedSearchAgainIcon />}
          onClick={onSearchAgain}
          disabled={!canSearchMatchmaking}
        />
        <RaisedButton
          label={t('matchmaking.postMatchDialog.watchReplay', 'Watch replay')}
          iconStart={<MaterialIcon icon='videocam' />}
          onClick={onWatchReplay}
          disabled={!replayPath}
        />
      </ButtonBar>
    </StyledDialog>
  )
}

function RatedUserContent({
  mmrChange,
  leagueValues,
}: {
  mmrChange: ReadonlyDeep<PublicMatchmakingRatingChangeJson>
  leagueValues: ReadonlyArray<{ league: ReadonlyDeep<LeagueJson>; value: number }>
}) {
  const { t } = useTranslation()
  const divisionTransitions = useMemo(() => {
    const placementPromotion = mmrChange.lifetimeGames === NUM_PLACEMENT_MATCHES
    let startingRating: number
    let divisions: Array<Readonly<MatchmakingDivisionWithBounds>>
    if (placementPromotion) {
      startingRating = 0
      const placedDivision = ratingToMatchmakingDivisionAndBounds(mmrChange.rating)
      divisions = [[MatchmakingDivision.Unrated, 0, placedDivision[1]], placedDivision]
    } else {
      startingRating = mmrChange.rating - mmrChange.ratingChange
      divisions = getDivisionsForRatingChange(startingRating, mmrChange.rating)
    }

    const isNegative = placementPromotion ? false : mmrChange.ratingChange < 0

    return divisions.map((divisionWithBounds, i) => {
      const [div, low, high] = divisionWithBounds
      if (div === MatchmakingDivision.Unrated) {
        return { divisionWithBounds, from: low, to: high }
      }

      let from = isNegative ? high : low
      let to = isNegative ? low : high

      if (i === 0) {
        from = startingRating
      }
      if (i === divisions.length - 1) {
        to = mmrChange.rating
      }

      return { divisionWithBounds, from, to }
    })
  }, [mmrChange])

  const [curDivisionWithBounds, setCurDivisionWithBounds] = useState(
    divisionTransitions[0].divisionWithBounds,
  )

  // NOTE(tec27): We need this because the async spring method (below) will keep advancing even if
  // the spring has been stopped, and we want it to stop if the dialog has been closed
  const isMounted = useRef(true)
  const ratingAnimAborter = useRef<AbortController | undefined>()
  const scoreSoundRef = useRef<AudioBufferSourceNode | undefined>()
  useEffect(() => {
    isMounted.current = true

    return () => {
      isMounted.current = false
      if (scoreSoundRef.current) {
        scoreSoundRef.current.loop = false
      }
      ratingAnimAborter.current?.abort()
    }
  }, [])

  const divisionSpringRef = useSpringRef()
  const [{ rating }] = useSpring<{ rating: number }>(
    {
      ref: divisionSpringRef,
      config: { mass: 120, tension: 200, friction: 100, clamp: true },
      from: {
        rating: divisionTransitions[0].from,
      },
      to: useCallback(
        async (next: (props: any) => Promise<unknown>) => {
          ratingAnimAborter.current?.abort()
          ratingAnimAborter.current = new AbortController()
          const { signal } = ratingAnimAborter.current

          scoreSoundRef.current?.stop()

          let first = true
          for (const { divisionWithBounds, from, to } of divisionTransitions) {
            if (signal.aborted) {
              break
            }
            setCurDivisionWithBounds(divisionWithBounds)
            if (!first) {
              audioManager.playSound(AvailableSound.RankUp, { when: 0.15 })
            }

            await next({
              rating: from,
              reset: true,
              immediate: true,
              delay: first ? 0 : 675,
            })
            if (signal.aborted) {
              break
            }

            scoreSoundRef.current?.stop()
            if (Math.round(Math.abs(to - from)) >= 1) {
              scoreSoundRef.current = audioManager.playSound(AvailableSound.ScoreCount, {
                loop: true,
              })
            }
            await next({
              rating: to,
            })

            if (scoreSoundRef.current) {
              scoreSoundRef.current.loop = false
            }
            scoreSoundRef.current = undefined
            first = false
          }
        },
        [divisionTransitions],
      ),
    },
    [divisionTransitions],
  )

  const deltaValues = useMemo(
    () => [
      { label: t('matchmaking.postMatchDialog.points', 'Points'), value: mmrChange.pointsChange },
      { label: t('matchmaking.postMatchDialog.rating', 'Rating'), value: mmrChange.ratingChange },
    ],
    [mmrChange.pointsChange, mmrChange.ratingChange, t],
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

  const deltaSpringRef = useSpringRef()
  const deltaTransition = useTransition(deltaValues, {
    ref: deltaSpringRef,
    keys: deltaValues.map(d => d.label),
    config: defaultSpring,
    delay: 500,
    trail: 750,
    from: {
      opacity: 0,
      translateY: 32,
    },
    enter: {
      opacity: 1,
      translateY: 0,
    },
    onStart: playPointRevealSound,
  })

  const leagueSpringRef = useSpringRef()
  const leagueTransition = useTransition(leagueValues, {
    ref: leagueSpringRef,
    keys: leagueValues.map(l => l.league.id),
    config: defaultSpring,
    delay: 500,
    from: {
      opacity: 0,
      translateY: 32,
    },
    enter: {
      opacity: 1,
      translateY: 0,
    },
    onStart: playPointRevealSound,
  })

  useChain(
    leagueValues.length > 0
      ? [deltaSpringRef, leagueSpringRef, divisionSpringRef]
      : [deltaSpringRef, divisionSpringRef],
  )

  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  return (
    <Content>
      <MatchmakingSide>
        <SideOverline>{t('matchmaking.postMatchDialog.matchmaking', 'Matchmaking')}</SideOverline>
        <IconAndDeltas>
          <IconWithLabel division={curDivisionWithBounds[0]} isWin={mmrChange.outcome === 'win'} />
          <Deltas>
            {deltaTransition((style, item) => (
              <AnimatedDeltaItem style={style} {...item} />
            ))}
          </Deltas>
        </IconAndDeltas>
        <RatingBarView rating={rating} divisionWithBounds={curDivisionWithBounds} />
      </MatchmakingSide>
      {leagueValues.length > 0 ? (
        <LeagueSide>
          <SideOverline>{t('matchmaking.postMatchDialog.leagues', 'Leagues')}</SideOverline>
          <Leagues>
            <GradientScrollDivider $showAt='top' $heightPx={32} $show={!isAtTop} />
            <LeaguesScrollable $needsScroll={!isAtTop || !isAtBottom}>
              {topElem}
              {leagueTransition((style, item) => (
                <LeagueTooltip text={item.league.name} position={'left'}>
                  <AnimatedLeagueDelta style={style} {...item} />
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

function UnratedUserContent({
  mmrChange,
  leagueValues,
}: {
  mmrChange: ReadonlyDeep<PublicMatchmakingRatingChangeJson>
  leagueValues: ReadonlyArray<{ league: ReadonlyDeep<LeagueJson>; value: number }>
}) {
  const { t } = useTranslation()
  const deltaValues = useMemo(
    () => [
      { label: t('matchmaking.postMatchDialog.points', 'Points'), value: mmrChange.pointsChange },
    ],
    [mmrChange.pointsChange, t],
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
  const deltaSpringRef = useSpringRef()
  const deltaTransition = useTransition(deltaValues, {
    ref: deltaSpringRef,
    keys: deltaValues.map(d => d.label),
    config: defaultSpring,
    delay: 500,
    trail: 750,
    from: {
      opacity: 0,
      translateY: 32,
    },
    enter: {
      opacity: 1,
      translateY: 0,
    },
    onStart: playPointRevealSound,
  })

  const leagueSpringRef = useSpringRef()
  const leagueTransition = useTransition(leagueValues, {
    ref: leagueSpringRef,
    keys: leagueValues.map(l => l.league.id),
    config: defaultSpring,
    delay: 500,
    from: {
      opacity: 0,
      translateY: 32,
    },
    enter: {
      opacity: 1,
      translateY: 0,
    },
    onStart: playPointRevealSound,
  })

  useChain(leagueValues.length > 0 ? [deltaSpringRef, leagueSpringRef] : [deltaSpringRef])

  const [isAtTop, isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  return (
    <Content>
      <MatchmakingSide>
        <SideOverline>{t('matchmaking.postMatchDialog.matchmaking', 'Matchmaking')}</SideOverline>
        <IconAndDeltas>
          <IconWithLabel
            division={MatchmakingDivision.Unrated}
            isWin={mmrChange.outcome === 'win'}
          />
          <Deltas>
            {deltaTransition((style, item) => (
              <AnimatedDeltaItem style={style} {...item} />
            ))}
          </Deltas>
        </IconAndDeltas>
        <PlacementCount lifetimeGames={mmrChange.lifetimeGames} />
      </MatchmakingSide>
      {leagueValues.length > 0 ? (
        <LeagueSide>
          <SideOverline>{t('matchmaking.postMatchDialog.leagues', 'Leagues')}</SideOverline>
          <Leagues>
            <GradientScrollDivider $showAt='top' $heightPx={32} $show={!isAtTop} />
            <LeaguesScrollable $needsScroll={!isAtTop || !isAtBottom}>
              {topElem}
              {leagueTransition((style, item) => (
                <LeagueTooltip text={item.league.name} position={'left'}>
                  <AnimatedLeagueDelta style={style} {...item} />
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

const DeltaItemRoot = styled.div`
  ${headline4};
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
  color: ${colorTextPrimary};
  text-align: right;
`

const DeltaLabel = styled.div`
  ${headline6};
  color: ${colorTextSecondary};
`

function DeltaItem({
  label,
  value,
  style,
}: {
  label: string
  value: number
  style?: React.CSSProperties
}) {
  const roundedValue = Math.round(value)

  return (
    <DeltaItemRoot style={style}>
      <DeltaValue>
        {roundedValue < 0 ? '' : '+'}
        {roundedValue}
      </DeltaValue>
      <DeltaLabel>{label}</DeltaLabel>
    </DeltaItemRoot>
  )
}

const LeagueDeltaRoot = styled.div`
  ${headline5};
  display: flex;
  align-items: center;
  gap: 16px;
`

function LeagueDelta({
  league,
  value,
  style,
}: {
  league: ReadonlyDeep<LeagueJson>
  value: number
  style?: React.CSSProperties
}) {
  const roundedValue = Math.round(value)

  return (
    <LeagueDeltaRoot style={style}>
      <LeagueBadge league={league} />
      {roundedValue < 0 ? '' : '+'}
      {roundedValue}
    </LeagueDeltaRoot>
  )
}

const IconWithLabelRoot = styled(animated.div)`
  position: relative;
  width: 176px;
  height: 212px;
`

const IconWithLabelElement = styled(animated.div)`
  position: absolute;
  top: 0;
  left: 0;
`

const StyledDivisionIcon = styled(DivisionIcon)`
  width: 176px;
  height: 176px;
`

const RankLabel = styled.div`
  ${headline6};
  ${singleLine};
  padding-top: 8px;
  text-align: center;
`

function IconWithLabel({ division, isWin }: { division: MatchmakingDivision; isWin: boolean }) {
  const { t } = useTranslation()
  const transition = useTransition(division, {
    key: division,
    config: (_item, _index, phase) => key => {
      if (phase === 'leave') {
        return { ...defaultSpring, clamp: true }
      } else if (key === 'filter') {
        return { ...defaultSpring, mass: 10, tension: 520, friction: 120 }
      } else {
        return defaultSpring
      }
    },
    exitBeforeEnter: true,
    initial: null,
    from: {
      opacity: 0,
      scale: 0.1,
      filter: 'saturate(200%) brightness(2) blur(8px)',
    },
    enter: item => [
      {
        opacity: 1,
        scale: 1,
        filter: 'saturate(100%) brightness(1) blur(0)',
      },
    ],
    leave: {
      opacity: -0.6,
      scale: 0.75,
    },
  })

  return (
    <IconWithLabelRoot>
      {transition((style, division) => (
        <IconWithLabelElement style={style}>
          <StyledDivisionIcon division={division} size={176} />
          <RankLabel>{matchmakingDivisionToLabel(division, t)}</RankLabel>
        </IconWithLabelElement>
      ))}
    </IconWithLabelRoot>
  )
}

const RatingBarRoot = styled.div`
  position: relative;
  width: var(--sb-post-match-rating-bar-width);
  height: 72px;
  padding: 32px 0 24px;
  overflow-x: visible;
`

const RatingBar = styled.div`
  position: relative;
  width: 100%;
  height: 20px;

  background-color: rgba(0, 0, 0, 0.24);
  border: 2px solid ${colorDividers};
  border-radius: 9999px;
  contain: paint;

  &::after {
    position: absolute;
    content: '';
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    background: var(--sb-rating-bar-bg, currentColor);
    transform: translateX(calc(-100% + 100% * var(--sb-rating-bar-scale, 0)));
    transform-origin: 100% 50%;
  }
`

const RatingLabelMover = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 52px;

  transform: translateX(var(--sb-rating-label-x, 0));
`

const RatingLabel = styled.div`
  ${caption};
  position: absolute;
  transform: translateX(-50%); // Center the text on the left edge of the box that we move (above)
`

const RatingBarView = animated(
  ({
    divisionWithBounds: [division, low, _high],
    rating,
  }: {
    divisionWithBounds: Readonly<MatchmakingDivisionWithBounds>
    rating: number
  }) => {
    const high =
      division === MatchmakingDivision.Champion
        ? // Champion runs forever, but that doesn't make for a particularly compelling bar, so we
          // pick a rating that his finite but unlikely to be achieved.
          Math.max(rating, 3000)
        : _high
    const divPercent = Math.min((rating - low) / (high - low), 1)

    const background = useMemo(() => {
      const divColor = getDivisionColor(division)
      const isSilver =
        division === MatchmakingDivision.Silver1 ||
        division === MatchmakingDivision.Silver2 ||
        division === MatchmakingDivision.Silver3

      return `linear-gradient(to right,
        ${darken(0.14, saturate(0.1, divColor))} 0%,
        ${divColor} 33%,
        ${divColor} 75%,
        ${lighten(0.12, saturate(isSilver ? 0.16 : 0.4, divColor))} 94%,
        ${lighten(0.14, saturate(isSilver ? 0.24 : 0.6, divColor))} 100%)`
    }, [division])

    return (
      <RatingBarRoot>
        <RatingBar
          style={
            {
              '--sb-rating-bar-bg': background,
              '--sb-rating-bar-scale': divPercent,
            } as any
          }
        />
        <RatingLabelMover style={{ '--sb-rating-label-x': `${100 * divPercent}%` } as any}>
          <RatingLabel>{Math.round(rating)}</RatingLabel>
        </RatingLabelMover>
      </RatingBarRoot>
    )
  },
)

const PlacementCountRoot = styled.div`
  ${headline5};
  width: var(--sb-post-match-rating-bar-width);
  padding: 24px 0 8px;

  color: ${colorTextSecondary};
  text-align: center;
`

function PlacementCount({ lifetimeGames }: { lifetimeGames: number }) {
  const { t } = useTranslation()
  return (
    <PlacementCountRoot>
      <Trans t={t} i18nKey='matchmaking.findMatch.remainingPlacements'>
        {{ lifetimeGames }} / {{ numPlacementMatches: NUM_PLACEMENT_MATCHES }} placements
      </Trans>
    </PlacementCountRoot>
  )
}
