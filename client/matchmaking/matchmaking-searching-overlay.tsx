import React from 'react'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceIcon } from '../lobbies/race-icon'
import { RaisedButton } from '../material/button'
import { fastOutSlowIn } from '../material/curve-constants.js'
import { LegacyPopover } from '../material/legacy-popover'
import { useAppSelector } from '../redux-hooks'
import { headline3, Headline6 } from '../styles/typography'
import { ElapsedTime } from './elapsed-time'
import { useTranslation } from 'react-i18next'

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

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const Contents = styled.div<{ $transitionDuration: number; $transitionDelay: number }>`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 288px;
  padding: 16px;

  &.enter {
    opacity: 0;
    transform: translateY(-16px);
  }

  &.enterActive {
    opacity: 1;
    transform: translateY(0px);
    transition: ${props => `
      opacity ${props.$transitionDuration}ms linear ${props.$transitionDelay}ms,
      transform ${props.$transitionDuration}ms ${fastOutSlowIn} ${props.$transitionDelay}ms
    `};
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition: ${props => `opacity ${props.$transitionDuration}ms linear`};
  }
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
  open: boolean
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
  const searchInfo = useAppSelector(s => s.matchmaking.searchInfo)
  const isMatched = useAppSelector(s => Boolean(s.matchmaking.match))
  const { t } = useTranslation()
  if (!searchInfo) {
    return null
  }

  return (
    <LegacyPopover
      open={open}
      onDismiss={onDismiss}
      anchor={anchor}
      anchorOriginVertical='top'
      anchorOriginHorizontal='right'
      popoverOriginVertical='top'
      popoverOriginHorizontal='right'
      anchorOffsetVertical={8}
      anchorOffsetHorizontal={-16}>
      {(state: any, timings: any) => {
        const { openDelay, openDuration, closeDuration } = timings
        let transitionDuration = 0
        let transitionDelay = 0
        if (state === 'opening') {
          transitionDuration = openDuration
          transitionDelay = openDelay
        } else if (state === 'opened') {
          transitionDuration = closeDuration
        }

        return (
          <CSSTransition
            in={state === 'opening' || state === 'opened'}
            classNames={transitionNames}
            appear={true}
            timeout={{
              appear: openDelay + openDuration,
              enter: openDuration,
              exit: closeDuration,
            }}>
            <Contents
              key='contents'
              $transitionDuration={transitionDuration}
              $transitionDelay={transitionDelay}>
              <Headline6>{matchmakingTypeToText(searchInfo.matchmakingType)}</Headline6>
              <InfoContainer>
                <InfoItem>
                  <StyledRaceIcon race={searchInfo.race} />
                </InfoItem>
                <InfoItem>
                  <StyledElapsedTime startTimeMs={searchInfo.startTime} />
                </InfoItem>
              </InfoContainer>
              <RaisedButton label={t('matchmaking.cancelSearchText', 'Cancel search')} onClick={onCancelSearch} disabled={isMatched} />
            </Contents>
          </CSSTransition>
        )
      }}
    </LegacyPopover>
  )
}
