import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './popover-test.css'

import IconButton from '../icon-button.jsx'
import VertMenuIcon from '../../icons/material/ic_more_vert_black_24px.svg'
import Popover from '../popover.jsx'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

export default class OverflowTest extends React.Component {
  state = {
    open: false,
  };

  _topLeft = null;
  _setTopLeft = elem => { this._topLeft = elem };
  _topRight = null;
  _setTopRight = elem => { this._topRight = elem };
  _bottomLeft = null;
  _setBottomLeft = elem => { this._bottomLeft = elem };
  _bottomRight = null;
  _setBottomRight = elem => { this._bottomRight = elem };

  render() {
    const containerStyle = {
      width: '100%',
      height: '100%',
      padding: 16,
      paddingTop: 64,
    }
    const contentStyle = {
      maxWidth: 640,
      minHeight: 512,
      paddingBottom: 32,
      margin: '0px auto',
      position: 'relative'
    }

    const menu = {
      position: 'absolute',
    }
    const topLeftStyle = {
      ...menu,
      top: 16,
      left: 16,
    }
    const topRightStyle = {
      ...menu,
      top: 16,
      right: 16,
    }
    const bottomLeftStyle = {
      ...menu,
      bottom: 16,
      left: 16,
    }
    const bottomRightStyle = {
      ...menu,
      bottom: 16,
      right: 16,
    }

    const { open } = this.state

    return (<div style={containerStyle}>
      <div style={contentStyle}>
        <IconButton style={topLeftStyle} buttonRef={this._setTopLeft}
          icon={<VertMenuIcon />} onClick={this.onTopLeftClick} />
        <IconButton style={topRightStyle} buttonRef={this._setTopRight}
          icon={<VertMenuIcon />} onClick={this.onTopRightClick} />
        <IconButton style={bottomLeftStyle} buttonRef={this._setBottomLeft}
          icon={<VertMenuIcon />} onClick={this.onBottomLeftClick} />
        <IconButton style={bottomRightStyle} buttonRef={this._setBottomRight}
          icon={<VertMenuIcon />} onClick={this.onBottomRightClick} />

        <Popover open={open === 'topLeft'} onDismiss={this.onDismiss} anchor={this._topLeft}
          children={this.renderPopoverContents}
          anchorOriginVertical='top' anchorOriginHorizontal='left'
          popoverOriginVertical='top' popoverOriginHorizontal='left'/>
        <Popover open={open === 'topRight'} onDismiss={this.onDismiss} anchor={this._topRight}
          children={this.renderPopoverContents}
          anchorOriginVertical='top' anchorOriginHorizontal='right'
          popoverOriginVertical='top' popoverOriginHorizontal='right'/>
        <Popover open={open === 'bottomLeft'} onDismiss={this.onDismiss} anchor={this._bottomLeft}
          children={this.renderPopoverContents}
          anchorOriginVertical='bottom' anchorOriginHorizontal='left'
          popoverOriginVertical='bottom' popoverOriginHorizontal='left'/>
        <Popover open={open === 'bottomRight'} onDismiss={this.onDismiss} anchor={this._bottomRight}
          children={this.renderPopoverContents}
          anchorOriginVertical='bottom' anchorOriginHorizontal='right'
          popoverOriginVertical='bottom' popoverOriginHorizontal='right'/>
      </div>
    </div>)
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

    return (<TransitionGroup
      transitionName={transitionNames} transitionAppear={true}
      transitionAppearTimeout={openDelay + openDuration}
      transitionEnterTimeout={openDuration} transitionLeaveTimeout={closeDuration}>
      {
        state === 'opening' || state === 'opened' ?
          <div className={styles.contents} style={style}>
            <h2>Hello</h2>
            <h3>World</h3>
            <h4>How are you?</h4>
          </div> :
          null
      }
    </TransitionGroup>)
  };

  onDismiss = () => {
    this.setState({ open: 'false' })
  };
  onTopLeftClick = () => {
    this.setState({ open: 'topLeft' })
  };
  onTopRightClick = () => {
    this.setState({ open: 'topRight' })
  };
  onBottomLeftClick = () => {
    this.setState({ open: 'bottomLeft' })
  };
  onBottomRightClick = () => {
    this.setState({ open: 'bottomRight' })
  };
}
