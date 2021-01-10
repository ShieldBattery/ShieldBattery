import React from 'react'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import IconButton from '../icon-button'
import VertMenuIcon from '../../icons/material/ic_more_vert_black_24px.svg'
import Popover from '../popover'

import { fastOutSlowIn } from '../curve-constants'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px !important;
  padding-top: 64px !important;
`

const Content = styled.div`
  position: relative;
  max-width: 640px;
  min-height: 512px;
  margin: 0px auto;
  padding-bottom: 32px;
`

const StyledIconButton = styled(IconButton)`
  position: absolute;
`

const TopLeftButton = styled(StyledIconButton)`
  top: 16px;
  left: 16px;
`

const TopRightButton = styled(StyledIconButton)`
  top: 16px;
  right: 16px;
`

const BottomLeftButton = styled(StyledIconButton)`
  bottom: 16px;
  left: 16px;
`

const BottomRightButton = styled(StyledIconButton)`
  bottom: 16px;
  right: 16px;
`

const PopoverContents = styled.div`
  min-width: 256px;
  position: relative;
  padding: 16px;

  &.enter {
    opacity: 0;
    transform: translateY(-16px);
    transition-property: all;
    transition-timing-function: ${fastOutSlowIn};
  }

  &.enterActive {
    opacity: 1;
    transform: translateY(0px);
  }

  &.exit {
    opacity: 1;
    transition-property: all;
    transition-timing-function: ${fastOutSlowIn};
  }

  &.exitActive {
    opacity: 0;
  }
`

export default class OverflowTest extends React.Component {
  state = {
    open: false,
  }

  _topLeft = React.createRef()
  _topRight = React.createRef()
  _bottomLeft = React.createRef()
  _bottomRight = React.createRef()

  render() {
    const { open } = this.state

    return (
      <Container>
        <Content>
          <TopLeftButton
            buttonRef={this._topLeft}
            icon={<VertMenuIcon />}
            onClick={this.onTopLeftClick}
          />
          <TopRightButton
            buttonRef={this._topRight}
            icon={<VertMenuIcon />}
            onClick={this.onTopRightClick}
          />
          <BottomLeftButton
            buttonRef={this._bottomLeft}
            icon={<VertMenuIcon />}
            onClick={this.onBottomLeftClick}
          />
          <BottomRightButton
            buttonRef={this._bottomRight}
            icon={<VertMenuIcon />}
            onClick={this.onBottomRightClick}
          />

          <Popover
            open={open === 'topLeft'}
            onDismiss={this.onDismiss}
            anchor={this._topLeft.current}
            children={this.renderPopoverContents}
            anchorOriginVertical='top'
            anchorOriginHorizontal='left'
            popoverOriginVertical='top'
            popoverOriginHorizontal='left'
          />
          <Popover
            open={open === 'topRight'}
            onDismiss={this.onDismiss}
            anchor={this._topRight.current}
            children={this.renderPopoverContents}
            anchorOriginVertical='top'
            anchorOriginHorizontal='right'
            popoverOriginVertical='top'
            popoverOriginHorizontal='right'
          />
          <Popover
            open={open === 'bottomLeft'}
            onDismiss={this.onDismiss}
            anchor={this._bottomLeft.current}
            children={this.renderPopoverContents}
            anchorOriginVertical='bottom'
            anchorOriginHorizontal='left'
            popoverOriginVertical='bottom'
            popoverOriginHorizontal='left'
          />
          <Popover
            open={open === 'bottomRight'}
            onDismiss={this.onDismiss}
            anchor={this._bottomRight.current}
            children={this.renderPopoverContents}
            anchorOriginVertical='bottom'
            anchorOriginHorizontal='right'
            popoverOriginVertical='bottom'
            popoverOriginHorizontal='right'
          />
        </Content>
      </Container>
    )
  }

  renderPopoverContents = (state, timings) => {
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
      <CSSTransition
        in={state === 'opening' || state === 'opened'}
        classNames={transitionNames}
        appear={true}
        timeout={{ appear: openDelay + openDuration, enter: openDuration, exit: closeDuration }}>
        <PopoverContents style={style}>
          <h2>Hello</h2>
          <h3>World</h3>
          <h4>How are you?</h4>
        </PopoverContents>
      </CSSTransition>
    )
  }

  onDismiss = () => {
    this.setState({ open: 'false' })
  }
  onTopLeftClick = () => {
    this.setState({ open: 'topLeft' })
  }
  onTopRightClick = () => {
    this.setState({ open: 'topRight' })
  }
  onBottomLeftClick = () => {
    this.setState({ open: 'bottomLeft' })
  }
  onBottomRightClick = () => {
    this.setState({ open: 'bottomRight' })
  }
}
