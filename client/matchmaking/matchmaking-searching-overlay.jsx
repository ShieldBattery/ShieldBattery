import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import RaceIcon from '../lobbies/race-icon'
import Popover from '../material/popover'
import RaisedButton from '../material/raised-button'
import { fastOutSlowIn } from '../material/curve-constants.js'
import { headline3, Headline6 } from '../styles/typography'

import { MatchmakingType } from '../../common/matchmaking'
import { ElapsedTime } from './elapsed-time'

// TODO(2Pac): Move this to a common folder if we decide to use this text elsewhere
function matchmakingTypeToText(type) {
  switch (type) {
    case MatchmakingType.Match1v1:
      return 'Ranked 1v1'
    default:
      throw new Error('Invalid matchmaking type')
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

const Contents = styled.div`
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
      opacity ${props.transitionDuration}ms linear ${props.transitionDelay}ms,
      transform ${props.transitionDuration}ms ${fastOutSlowIn} ${props.transitionDelay}ms
    `};
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition: ${props => `opacity ${props.transitionDuration}ms linear`};
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

export default class MatchmakingSearchingOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    anchor: PropTypes.object,
    startTime: PropTypes.number,
    matchmakingType: PropTypes.string,
    selectedRace: PropTypes.string,
    onCancelSearch: PropTypes.func.isRequired,
    onDismiss: PropTypes.func.isRequired,
  }

  render() {
    const {
      open,
      anchor,
      startTime,
      matchmakingType,
      selectedRace,
      onCancelSearch,
      onDismiss,
    } = this.props

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='top'
        anchorOriginHorizontal='right'
        popoverOriginVertical='top'
        popoverOriginHorizontal='right'
        anchorOffsetVertical={8}
        anchorOffsetHorizontal={-16}>
        {(state, timings) => {
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
                transitionDuration={transitionDuration}
                transitionDelay={transitionDelay}>
                <Headline6>{matchmakingTypeToText(matchmakingType)}</Headline6>
                <InfoContainer>
                  <InfoItem>
                    <StyledRaceIcon race={selectedRace} />
                  </InfoItem>
                  <InfoItem>
                    <StyledElapsedTime startTimeMs={startTime} />
                  </InfoItem>
                </InfoContainer>
                <RaisedButton label='Cancel search' onClick={onCancelSearch} />
              </Contents>
            </CSSTransition>
          )
        }}
      </Popover>
    )
  }
}
