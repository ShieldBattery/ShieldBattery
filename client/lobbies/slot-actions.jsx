import React from 'react'
import PropTypes from 'prop-types'
import TransitionGroup from 'react-addons-css-transition-group'
import styled from 'styled-components'

import IconButton from '../material/icon-button.jsx'
import MenuItem from '../material/menu/item.jsx'
import Popover from '../material/popover.jsx'
import SlotActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'
import { fastOutSlowIn } from '../material/curve-constants.js'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  leave: 'leave',
  leaveActive: 'leaveActive',
}

export default class SlotActions extends React.Component {
  static propTypes = {
    slotActions: PropTypes.array,
  }

  state = {
    slotActionsOverlayOpened: false,
  }

  _slotActionsButtonRef = null
  _setSlotActionsButtonRef = elem => {
    this._slotActionsButtonRef = elem
  }

  render() {
    const { slotActions } = this.props
    const actions = slotActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={handler} />
    ))

    return (
      <div>
        <IconButton
          icon={<SlotActionsIcon />}
          title='Slot actions'
          buttonRef={this._setSlotActionsButtonRef}
          onClick={this.onSlotActionsClick}
        />
        <SlotActionsOverlay
          open={this.state.slotActionsOverlayOpened}
          onDismiss={this.onCloseSlotActionsOverlay}
          anchor={this._slotActionsButtonRef}>
          {actions}
        </SlotActionsOverlay>
      </div>
    )
  }

  onSlotActionsClick = type => {
    this.setState({
      slotActionsOverlayOpened: true,
    })
  }

  onCloseSlotActionsOverlay = () => {
    this.setState({
      slotActionsOverlayOpened: false,
    })
  }
}

export class SlotActionsOverlay extends React.Component {
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
          let style
          if (state === 'opening') {
            style = {
              transitionDuration: `${openDuration}ms`,
              transitionDelay: `${openDelay}ms`,
            }
          } else if (state === 'opened') {
            style = {
              transitionDuration: `${closeDuration}ms`,
            }
          }

          return (
            <TransitionGroup
              transitionName={transitionNames}
              transitionAppear={true}
              transitionAppearTimeout={openDuration}
              transitionEnterTimeout={openDuration}
              transitionLeaveTimeout={closeDuration}>
              {state === 'opening' || state === 'opened' ? (
                <SlotActionsContents key={'contents'} style={style}>
                  {children}
                </SlotActionsContents>
              ) : null}
            </TransitionGroup>
          )
        }}
      </Popover>
    )
  }
}

const ContentsRoot = styled.div`
  min-width: 160px;
`

const SlotActionsContainer = styled.div`
  position: relative;
  padding-top: 8px;
  padding-bottom: 8px;

  .enter & {
    opacity: 0;
    transition-property: opacity;
    transition-timing-function: ${fastOutSlowIn};
  }

  .enterActive & {
    opacity: 1;
  }

  .leave & {
    opacity: 1;
    transition-property: opacity;
    transition-timing-function: ${fastOutSlowIn};
  }

  .leaveActive & {
    opacity: 0;
  }
`

export class SlotActionsContents extends React.Component {
  static propTypes = {
    style: PropTypes.object,
  }

  render() {
    const { children, style } = this.props

    return (
      <ContentsRoot>
        <SlotActionsContainer style={style}>{children}</SlotActionsContainer>
      </ContentsRoot>
    )
  }
}
