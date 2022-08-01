import React from 'react'
import styled from 'styled-components'
import {
  getDivisionColor,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  ratingToMatchmakingDivisionAndBounds,
} from '../../common/matchmaking'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { PostMatchDialogPayload } from '../dialogs/dialog-type'
import { searchAgainFromGame } from '../games/action-creators'
import WatchReplayIcon from '../icons/material/videocam_24px.svg'
import SearchAgainIcon from '../icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { RaisedButton } from '../material/button'
import { Body, Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { colorDividers, colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { caption, headline4, headline6 } from '../styles/typography'
import { RankIcon } from './rank-icon'

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
`

const IconWithLabel = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const StyledRankIcon = styled(RankIcon)`
  width: 176px;
  height: 176px;
`

const RankLabel = styled.div`
  ${headline6};
  padding-top: 8px;
`

const Deltas = styled.div`
  padding-top: 44px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const RatingBarContainer = styled.div`
  position: relative;
  width: 100%;
  height: 72px;
  padding: 24px 0;
  overflow-x: visible;
`

const RatingBar = styled.div<{ $scale: number }>`
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
    transform: ${props => `scaleX(${props.$scale})`};
    transform-origin: 0% 50%;
  }
`

const RatingLabelMover = styled.div<{ $centerXPercent: number }>`
  position: absolute;
  left: 0;
  right: 0;
  top: 48px;

  transform: ${props => `translateX(${100 * props.$centerXPercent}%)`};
`

const RatingLabel = styled.div`
  ${caption};
  position: absolute;
  transform: translateX(-50%); // Center the text on the left edge of the box that we move (above)
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

export function PostMatchDialog({ dialogRef, onCancel, game, mmrChange }: PostMatchDialogProps) {
  const dispatch = useAppDispatch()
  const onSearchAgain = useStableCallback(() => {
    dispatch(searchAgainFromGame(game.config))
    onCancel()
  })
  const onWatchReplay = useStableCallback(() => {
    // TODO(tec27): Implement last replay watching
    dispatch(openSnackbar({ message: 'Not yet implemented' }))
    onCancel()
  })
  const canSearchMatchmaking = useAppSelector(s => {
    const currentParty = s.party.current
    const isSearching = !!s.matchmaking.searchInfo
    return !isSearching && (!currentParty || currentParty.leader === s.auth.user.id)
  })

  const [division, divLow, _divHigh] = ratingToMatchmakingDivisionAndBounds(mmrChange.rating)
  const divHigh =
    division === MatchmakingDivision.Champion
      ? // Champion runs forever, but that doesn't make for a particularly compelling bar, so we
        // pick a rating that his finite but unlikely to be achieved.
        Math.max(mmrChange.rating, 3000)
      : _divHigh
  const divPercent = (mmrChange.rating - divLow) / (divHigh - divLow)

  return (
    <StyledDialog
      dialogRef={dialogRef}
      showCloseButton={true}
      title='Match results'
      onCancel={onCancel}>
      <IconAndDeltas>
        <IconWithLabel>
          <StyledRankIcon rating={mmrChange.rating} size={176} />
          <RankLabel>{matchmakingDivisionToLabel(division)}</RankLabel>
        </IconWithLabel>
        <Deltas>
          <DeltaItem label='RP' value={mmrChange.pointsChange} />
          <DeltaItem label='MMR' value={mmrChange.ratingChange} />
        </Deltas>
      </IconAndDeltas>
      <RatingBarContainer>
        <RatingBar style={{ color: getDivisionColor(division) }} $scale={divPercent} />
        <RatingLabelMover $centerXPercent={divPercent}>
          <RatingLabel>{Math.round(mmrChange.rating)}</RatingLabel>
        </RatingLabelMover>
      </RatingBarContainer>
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
        />
      </ButtonBar>
    </StyledDialog>
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

function DeltaItem({ label, value }: { label: string; value: number }) {
  const roundedValue = Math.round(value)

  return (
    <DeltaItemRoot>
      <DeltaValue>
        {roundedValue < 0 ? '' : '+'}
        {roundedValue}
      </DeltaValue>
      <DeltaLabel>{label}</DeltaLabel>
    </DeltaItemRoot>
  )
}
