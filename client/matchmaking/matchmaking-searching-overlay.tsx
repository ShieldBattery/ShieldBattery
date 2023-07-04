import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceIcon } from '../lobbies/race-icon'
import { RaisedButton } from '../material/button'
import { Popover, PopoverOpenState, useAnchorPosition } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { Headline6, headline3 } from '../styles/typography'
import { ElapsedTime } from './elapsed-time'

// TODO(2Pac): Move this to a common folder if we decide to use this text elsewhere
function matchmakingTypeToText(type: MatchmakingType) {
  switch (type) {
    case MatchmakingType.Match1v1:
      return 'Ranked 1v1'
    case MatchmakingType.Match2v2:
      return 'Ranked 2v2'
    default:
      return assertUnreachable(type)
  }
}

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
  ${headline3};
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
        <Headline6>{matchmakingTypeToText(searchInfo.matchmakingType)}</Headline6>
        <InfoContainer>
          <InfoItem>
            <StyledRaceIcon race={searchInfo.race} />
          </InfoItem>
          <InfoItem>
            <StyledElapsedTime startTimeMs={searchInfo.startTime} />
          </InfoItem>
        </InfoContainer>
        <RaisedButton
          label={t('matchmaking.searchingOverlay.cancelSearch', 'Cancel search')}
          onClick={onCancelSearch}
          disabled={isMatched}
        />
      </Contents>
    </Popover>
  )
}
