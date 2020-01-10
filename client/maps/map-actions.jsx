import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import IconButton from '../material/icon-button.jsx'
import MenuItem from '../material/menu/item.jsx'
import Popover from '../material/popover.jsx'
import MapActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'

import { fastOutSlowIn } from '../material/curve-constants'
import { colorTextSecondary } from '../styles/colors'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const MapActionsContainer = styled.div`
  display: flex;
`

const MapActionButton = styled(IconButton)`
  min-height: 40px !important;
  width: 40px !important;
  padding: 0 !important;
  line-height: 40px !important;
  margin-left: 4px !important;

  & > span {
    color: ${colorTextSecondary} !important;
    line-height: 40px !important;
  }
`

const MapActionsContents = styled.div`
  min-width: 160px;
  padding: 8px 0;

  &.enter {
    opacity: 0;
  }

  &.enterActive {
    opacity: 1;
    transition-property: opacity;
    transition-duration: ${props => props.transitionDuration}ms;
    transition-timing-function: ${fastOutSlowIn};
    transition-delay: ${props => props.transitionDelay}ms;
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition-property: opacity;
    transition-duration: ${props => props.transitionDuration}ms;
    transition-timing-function: ${fastOutSlowIn};
  }
`

class MapActionsOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  render() {
    const { children, open, onDismiss, anchor } = this.props

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='top'
        anchorOriginHorizontal='right'
        popoverOriginVertical='top'
        popoverOriginHorizontal='right'>
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
              timeout={{ appear: openDuration, enter: openDuration, exit: closeDuration }}>
              <MapActionsContents
                key={'contents'}
                transitionDuration={transitionDuration}
                transitionDelay={transitionDelay}>
                {children}
              </MapActionsContents>
            </CSSTransition>
          )
        }}
      </Popover>
    )
  }
}

export default class MapActions extends React.Component {
  static propTypes = {
    mapActions: PropTypes.array,
  }

  state = {
    mapActionsOverlayOpened: false,
  }

  _mapActionsButtonRef = null
  _setMapActionsButtonRef = elem => {
    this._mapActionsButtonRef = elem
  }

  render() {
    const { mapActions } = this.props
    const actions = mapActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={() => this.onMapActionClick(handler)} />
    ))

    return (
      <MapActionsContainer>
        <MapActionButton
          icon={<MapActionsIcon />}
          title='Map actions'
          buttonRef={this._setMapActionsButtonRef}
          onClick={this.onOpenMapActions}
        />
        <MapActionsOverlay
          open={this.state.mapActionsOverlayOpened}
          onDismiss={this.onCloseMapActionsOverlay}
          anchor={this._mapActionsButtonRef}>
          {actions}
        </MapActionsOverlay>
      </MapActionsContainer>
    )
  }

  onOpenMapActions = type => {
    this.setState({
      mapActionsOverlayOpened: true,
    })
  }

  onCloseMapActionsOverlay = () => {
    this.setState({
      mapActionsOverlayOpened: false,
    })
  }

  onMapActionClick = handler => {
    handler()
    this.onCloseMapActionsOverlay()
  }
}
