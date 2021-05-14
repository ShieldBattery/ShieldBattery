import keycode from 'keycode'
import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import CloseDialogIcon from '../icons/material/ic_close_black_24px.svg'
import KeyListener from '../keyboard/key-listener'
import IconButton from '../material/icon-button'
import { CardLayer, colorDividers } from '../styles/colors'
import { headline5 } from '../styles/typography'
import { animationFrameHandler } from './animation-frame-handler'
import { fastOutLinearIn, fastOutSlowIn, linearOutSlowIn } from './curve-constants'
import { shadowDef8dp } from './shadow-constants'
import { zIndexDialog } from './zindex'

const ESCAPE = keycode('esc')

const Container = styled.div`
  position: absolute;
  left: var(--pixel-shove-x, 0);
  right: 0;
  top: var(--pixel-shove-y, 0);
  bottom: 0;

  display: flex;
  align-items: center;
  justify-content: space-around;
  pointer-events: none;
  z-index: ${zIndexDialog};
`

const Surface = styled(CardLayer)`
  width: calc(100% - 160px);
  max-width: 768px;
  max-height: calc(100% - 160px);
  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;

  border-radius: 2px;
  box-shadow: ${shadowDef8dp};
  pointer-events: auto;

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
  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  border-bottom: 1px solid ${props => (props.showDivider ? colorDividers : 'transparent')};
  transition: border-color 150ms linear;
`

const Title = styled.div`
  ${headline5};
  flex-grow: 1;
  padding: 24px 24px 20px;
`

const CloseButton = styled(IconButton)`
  flex-shrink: 0;
  margin-right: 12px;
`

const Body = styled.div`
  width: 100%;
  min-height: 100px;
  flex-grow: 1;

  contain: content;
  padding: 0 24px 24px;
  overflow: auto;
`

const Actions = styled.div`
  flex-grow: 0;
  flex-shrink: 0;

  padding: 8px 4px 0;
  margin-bottom: 2px;
  border-top: 1px solid ${props => (props.showDivider ? colorDividers : 'transparent')};
  transition: border-color 150ms linear;
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
    /** Ref that will be assigned to the root of the dialog contents (useful for CSSTransition) */
    dialogRef: PropTypes.object,
  }

  state = {
    scrolledUp: false,
    scrolledDown: false,
  }

  componentWillUnmount() {
    this.onScrollUpdate.cancel()
  }

  render() {
    const { title, titleAction, showCloseButton, tabs, buttons, dialogRef } = this.props
    const { scrolledUp, scrolledDown } = this.state

    const closeButton = showCloseButton ? (
      <CloseButton
        icon={<CloseDialogIcon />}
        title='Close dialog'
        onClick={this.onCloseButtonClick}
      />
    ) : null

    return (
      <Container role='dialog'>
        <Surface className={this.props.className} ref={dialogRef}>
          <KeyListener onKeyDown={this.onKeyDown} exclusive={true} />
          <TitleBar showDivider={scrolledDown && !tabs}>
            <Title>{title}</Title>
            {titleAction}
            {closeButton}
          </TitleBar>
          {tabs}

          <Body onScroll={this.onScrollUpdate.handler}>{this.props.children}</Body>
          {buttons && buttons.length ? <Actions showDivider={scrolledUp}>{buttons}</Actions> : null}
        </Surface>
      </Container>
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

  onScrollUpdate = animationFrameHandler(target => {
    const { scrollTop, scrollHeight, clientHeight } = target
    const scrolledUp = scrollTop + clientHeight < scrollHeight
    const scrolledDown = scrollTop > 0

    if (scrolledUp !== this.state.scrolledUp || scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledUp, scrolledDown })
    }
  })
}

export default Dialog
