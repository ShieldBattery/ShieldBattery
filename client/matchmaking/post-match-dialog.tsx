import { Immutable } from 'immer'
import { darken, lighten, saturate } from 'polished'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { animated, useChain, useSpring, useSpringRef, useTransition } from 'react-spring'
import styled from 'styled-components'
import {
  getDivisionColor,
  getDivisionsForRatingChange,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingDivisionWithBounds,
  NUM_PLACEMENT_MATCHES,
  PublicMatchmakingRatingChangeJson,
  ratingToMatchmakingDivisionAndBounds,
} from '../../common/matchmaking'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { PostMatchDialogPayload } from '../dialogs/dialog-type'
import { searchAgainFromGame } from '../games/action-creators'
import WatchReplayIcon from '../icons/material/videocam_24px.svg'
import SearchAgainIcon from '../icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { RaisedButton } from '../material/button'
import { Body, Dialog } from '../material/dialog'
import { defaultSpring } from '../material/springs'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { startReplayFromPath } from '../replays/action-creators'
import { useStableCallback } from '../state-hooks'
import { colorDividers, colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { caption, headline4, headline5, headline6, singleLine } from '../styles/typography'
import { DivisionIcon } from './rank-icon'

const StyledDialog = styled(Dialog)`
  max-width: 480px;

  & ${Body} {
    overflow-x: hidden;
  }
`

const IconAndDeltas = styled.div`
  display: flex;
  gap: 40px;
  align-items: flex-start;
  padding-top: 16px;
`

const Deltas = styled.div<{ $pointsOnly?: boolean }>`
  padding-top: ${props => (props.$pointsOnly ? '68px' : '44px')};
  display: flex;
  flex-direction: column;
  gap: 16px;
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

type PostMatchDialogProps = CommonDialogProps & Immutable<PostMatchDialogPayload['initData']>

export function PostMatchDialog({
  dialogRef,
  onCancel,
  game,
  mmrChange,
  replayPath,
}: PostMatchDialogProps) {
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

  return (
    <StyledDialog
      dialogRef={dialogRef}
      showCloseButton={true}
      title='Match results'
      onCancel={onCancel}>
      {mmrChange.lifetimeGames >= NUM_PLACEMENT_MATCHES ? (
        <RatedUserContent mmrChange={mmrChange} />
      ) : (
        <UnratedUserContent mmrChange={mmrChange} />
      )}
      <ButtonBar>
        <RaisedButton
          label='Search again'
          iconStart={<SizedSearchAgainIcon />}
          onClick={onSearchAgain}
          disabled={!canSearchMatchmaking}
        />
        <RaisedButton
          label='Watch replay'
          iconStart={<WatchReplayIcon />}
          onClick={onWatchReplay}
          disabled={!replayPath}
        />
      </ButtonBar>
    </StyledDialog>
  )
}

function RatedUserContent({
  mmrChange,
}: {
  mmrChange: Immutable<PublicMatchmakingRatingChangeJson>
}) {
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
            if (Math.round(to - from) >= 1) {
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
      { label: 'RP', value: mmrChange.pointsChange },
      { label: 'MMR', value: mmrChange.ratingChange },
    ],
    [mmrChange],
  )

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
    onStart: useCallback((...args: any[]) => {
      audioManager.playSound(AvailableSound.PointReveal)
    }, []),
  })

  useChain([deltaSpringRef, divisionSpringRef])

  return (
    <>
      <IconAndDeltas>
        <IconWithLabel division={curDivisionWithBounds[0]} isWin={mmrChange.outcome === 'win'} />
        <Deltas $pointsOnly={mmrChange.lifetimeGames === NUM_PLACEMENT_MATCHES}>
          {deltaTransition((style, item) => (
            <AnimatedDeltaItem style={style} {...item} />
          ))}
        </Deltas>
      </IconAndDeltas>
      <RatingBarView rating={rating} divisionWithBounds={curDivisionWithBounds} />
    </>
  )
}

function UnratedUserContent({
  mmrChange,
}: {
  mmrChange: Immutable<PublicMatchmakingRatingChangeJson>
}) {
  const deltaValues = useMemo(() => [{ label: 'RP', value: mmrChange.pointsChange }], [mmrChange])

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
    onStart: useCallback((...args: any[]) => {
      audioManager.playSound(AvailableSound.PointReveal)
    }, []),
  })

  useChain([deltaSpringRef])

  return (
    <>
      <IconAndDeltas>
        <IconWithLabel division={MatchmakingDivision.Unrated} isWin={mmrChange.outcome === 'win'} />
        <Deltas $pointsOnly={true}>
          {deltaTransition((style, item) => (
            <AnimatedDeltaItem style={style} {...item} />
          ))}
        </Deltas>
      </IconAndDeltas>
      <PlacementCount lifetimeGames={mmrChange.lifetimeGames} />
    </>
  )
}

const DeltaItemRoot = styled.div`
  ${headline4};
  display: flex;
  gap: 12px;
`

const DeltaValue = styled.div`
  width: 104px;
  flex-grow: 0;
  color: ${colorTextPrimary};
  text-align: right;
`

const DeltaLabel = styled.div`
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
          <RankLabel>{matchmakingDivisionToLabel(division)}</RankLabel>
        </IconWithLabelElement>
      ))}
    </IconWithLabelRoot>
  )
}

const RatingBarRoot = styled.div`
  position: relative;
  width: 100%;
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
  padding: 24px 0 8px;

  color: ${colorTextSecondary};
  text-align: center;
`

function PlacementCount({ lifetimeGames }: { lifetimeGames: number }) {
  return (
    <PlacementCountRoot>
      {lifetimeGames} / {NUM_PLACEMENT_MATCHES} placements
    </PlacementCountRoot>
  )
}
