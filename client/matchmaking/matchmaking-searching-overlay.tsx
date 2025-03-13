import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { RaceIcon } from '../lobbies/race-icon'
import { ElevatedButton } from '../material/button'
import { Popover, PopoverOpenState, useAnchorPosition } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { TitleLarge, displaySmall } from '../styles/typography'
import { ElapsedTime } from './elapsed-time'

const Contents = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 288px;
  padding: 16px;
`

const InfoContainer = styled.div`
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 80px;
  margin: 16px 0 24px 0;
`

const InfoItem = styled.div`
  flex-grow: 1 1 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 50%;

  &:first-child {
    margin-right: 8px;
  }
`

const StyledRaceIcon = styled(RaceIcon)`
  width: 80px;
  height: 80px;
`

const StyledElapsedTime = styled(ElapsedTime)`
  ${displaySmall};
`

export interface MatchmakingSearchingOverlayProps {
  open: PopoverOpenState
  anchor?: HTMLButtonElement
  onCancelSearch: () => void
  onDismiss: () => void
}

export function MatchmakingSearchingOverlay({
  open,
  anchor,
  onCancelSearch,
  onDismiss,
}: MatchmakingSearchingOverlayProps) {
  const { t } = useTranslation()
  const searchInfo = useAppSelector(s => s.matchmaking.searchInfo)
  const isMatched = useAppSelector(s => Boolean(s.matchmaking.match))

  const [, anchorX, anchorY] = useAnchorPosition('right', 'top', anchor)

  if (!searchInfo) {
    return null
  }

  return (
    <Popover
      open={open}
      onDismiss={onDismiss}
      anchorX={anchorX ?? 0}
      anchorY={anchorY ?? 0}
      originX='right'
      originY='top'>
      <Contents>
        <TitleLarge>{matchmakingTypeToLabel(searchInfo.matchmakingType, t)}</TitleLarge>
        <InfoContainer>
          <InfoItem>
            <StyledRaceIcon race={searchInfo.race} />
          </InfoItem>
          <InfoItem>
            <StyledElapsedTime startTimeMs={searchInfo.startTime} />
          </InfoItem>
        </InfoContainer>
        <ElevatedButton
          label={t('matchmaking.searchingOverlay.cancelSearch', 'Cancel search')}
          onClick={onCancelSearch}
          disabled={isMatched}
        />
      </Contents>
    </Popover>
  )
}
