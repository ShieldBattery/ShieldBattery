import React from 'react'
import PropTypes from 'prop-types'
import keycode from 'keycode'
import styled from 'styled-components'

import IconButton from '../material/icon-button.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

import CloseDialogIcon from '../icons/material/ic_close_black_24px.svg'

import { linearOutSlowIn, fastOutSlowIn, fastOutLinearIn } from './curve-constants'
import { shadowDef8dp } from './shadow-constants'
import { zIndexDialog } from './zindex'
import { colorDividers, CardLayer } from '../styles/colors'
import { HeadlineOld } from '../styles/typography'

const ESCAPE = keycode('esc')

const Contents = styled(CardLayer)`
  position: fixed;
  display: table;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 80%;
  height: auto;
  max-width: 768px;
  max-height: 80%;
  margin: auto;
  z-index: ${zIndexDialog};
  border-radius: 2px;
  box-shadow: ${shadowDef8dp};

  &.enter {
    transform: translate3d(0, -100%, 0) scale(0.6, 0.2);
    opacity: 0;
  }

  &.enterActive {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
    transition: transform 350ms ${linearOutSlowIn}, opacity 250ms ${fastOutSlowIn};
  }

  &.exit {
    pointer-events: none;
    transform: translate3d(0, 0, 0) scale(1);
    opacity: 1;
  }

  &.exitActive {
    transform: translate3d(0, -100%, 0) scale(0.6, 0.2);
    opacity: 0;
    transition: transform 250ms ${fastOutLinearIn}, opacity 200ms ${fastOutSlowIn} 50ms;
  }
`

const TitleBar = styled.div`
  display: flex;
  align-items: center;
`

const Title = styled(HeadlineOld)`
  flex-grow: 1;
  margin: 0;
  padding: 24px 24px 20px;
`

const CloseButton = styled(IconButton)`
  flex-shrink: 0;
  margin-right: 12px;
`

const ScrollDivider = styled.div`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.position === 'bottom' ? '-1px' : '0')};
  background-color: ${colorDividers};
`

const Body = styled.div`
  padding: 0 24px 24px;
`

const Actions = styled.div`
  padding: 8px 4px 0;
  margin-bottom: 2px;
  width: 100%;
  text-align: right;
`

class Dialog extends React.Component {
  static propTypes = {
    onCancel: PropTypes.func,
    title: PropTypes.string.isRequired,
    titleAction: PropTypes.element,
    showCloseButton: PropTypes.bool,
    tabs: PropTypes.element,
    buttons: PropTypes.arrayOf(PropTypes.element),
  }

  state = {
    scrolledUp: false,
    scrolledDown: false,
  }

  render() {
    const { title, titleAction, showCloseButton, tabs, buttons } = this.props
    const { scrolledUp, scrolledDown } = this.state

    const closeButton = showCloseButton ? (
      <CloseButton
        icon={<CloseDialogIcon />}
        title='Close dialog'
        onClick={this.onCloseButtonClick}
      />
    ) : null

    return (
      <Contents role='dialog' className={this.props.className}>
        <KeyListener onKeyDown={this.onKeyDown} exclusive={true} />
        <TitleBar>
          <Title>{title}</Title>
          {titleAction}
          {closeButton}
        </TitleBar>
        {tabs}
        {scrolledDown || tabs ? <ScrollDivider position='top' /> : null}
        <ScrollableContent
          autoHeight={true}
          autoHeightMin={'100px'}
          autoHeightMax={'calc(80vh - 132px)'}
          onUpdate={this.onScrollUpdate}>
          <Body>{this.props.children}</Body>
        </ScrollableContent>
        {scrolledUp && buttons && buttons.length ? <ScrollDivider position='bottom' /> : null}
        {buttons && buttons.length ? <Actions>{buttons}</Actions> : null}
      </Contents>
    )
  }

  onCloseButtonClick = () => {
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }

  onKeyDown = event => {
    if (this.props.onCancel && event.keyCode === ESCAPE) {
      this.props.onCancel()
      return true
    }

    return false
  }

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values
    const scrolledUp = scrollTop + clientHeight < scrollHeight
    const scrolledDown = scrollTop > 0

    if (scrolledUp !== this.state.scrolledUp || scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledUp, scrolledDown })
    }
  }
}

export default Dialog
