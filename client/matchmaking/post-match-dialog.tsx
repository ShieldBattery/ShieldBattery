import React, { useCallback, useMemo, useState } from 'react'
import {
  animated,
  SpringValues,
  useChain,
  useSpring,
  useSpringRef,
  useTransition,
} from 'react-spring'
import styled from 'styled-components'
import {
  getDivisionColor,
  getDivisionsForRatingChange,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingDivisionWithBounds,
} from '../../common/matchmaking'
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
import { caption, headline4, headline6, singleLine } from '../styles/typography'
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

const Deltas = styled.div`
  padding-top: 44px;
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

type PostMatchDialogProps = CommonDialogProps & PostMatchDialogPayload['initData']

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

  const divisionTransitions = useMemo(() => {
    const startingRating = mmrChange.rating - mmrChange.ratingChange
    const divisions = getDivisionsForRatingChange(startingRating, mmrChange.rating)
    const isNegative = mmrChange.ratingChange < 0

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

  const divisionSpringRef = useSpringRef()
  const { rating } = useSpring<{
    divisionWithBounds: MatchmakingDivisionWithBounds
    rating: number
  }>({
    ref: divisionSpringRef,
    config: { mass: 120, tension: 200, friction: 100, clamp: true },
    from: {
      rating: divisionTransitions[0].from,
    },
    to: useCallback(
      async (next: (props: any) => Promise<unknown>) => {
        let first = true
        for (const { divisionWithBounds, from, to } of divisionTransitions) {
          setCurDivisionWithBounds(divisionWithBounds)
          await next({ rating: from, reset: true, delay: first ? 0 : 175 })
          await next({ rating: to })
          first = false
        }
      },
      [divisionTransitions],
    ),
  })

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
    config: defaultSpring,
    delay: 200,
    trail: 750,
    from: {
      opacity: 0,
      translateY: 24,
    },
    enter: {
      opacity: 1,
      translateY: 0,
    },
  })

  useChain([deltaSpringRef, divisionSpringRef])

  return (
    <StyledDialog
      dialogRef={dialogRef}
      showCloseButton={true}
      title='Match results'
      onCancel={onCancel}>
      <IconAndDeltas>
        <IconWithLabel division={curDivisionWithBounds[0]} isWin={mmrChange.outcome === 'win'} />
        <Deltas>
          {deltaTransition((style, item) => (
            <DeltaItem style={style} {...item} />
          ))}
        </Deltas>
      </IconAndDeltas>
      <RatingBarView rating={rating} divisionWithBounds={curDivisionWithBounds} />
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

const DeltaItemRoot = styled(animated.div)`
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
  style?: SpringValues<{ opacity: number; translateY: number }>
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
    config: (_item, _index, phase) => key =>
      phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
    initial: {
      opacity: 1,
      scale: 1,
    },
    from: {
      opacity: 0,
      scale: 0.2,
    },
    enter: item => [
      {
        opacity: 1,
        scale: 1,
      },
    ],
    leave: {
      opacity: -0.6,
      scale: 0.2,
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

    background-color: currentColor;
    transform: scaleX(var(--sb-rating-bar-scale, 0));
    transform-origin: 0% 50%;
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

    return (
      <RatingBarRoot>
        <RatingBar
          style={{ color: getDivisionColor(division), '--sb-rating-bar-scale': divPercent } as any}
        />
        <RatingLabelMover style={{ '--sb-rating-label-x': `${100 * divPercent}%` } as any}>
          <RatingLabel>{Math.round(rating)}</RatingLabel>
        </RatingLabelMover>
      </RatingBarRoot>
    )
  },
)
