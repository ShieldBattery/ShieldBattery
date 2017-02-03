import React, { PropTypes } from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './view.css'

import IconButton from '../material/icon-button.jsx'
import MenuItem from '../material/menu/item.jsx'
import Popover from '../material/popover.jsx'
import SlotActionsIcon from '../icons/material/ic_more_vert_black_24px.svg'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

export default class SlotActions extends React.Component {
  static propTypes = {
    slotActions: PropTypes.array,
  };

  state = {
    slotActionsOverlayOpened: false,
  };

  _slotActionsButtonRef = null;
  _setSlotActionsButtonRef = elem => { this._slotActionsButtonRef = elem };

  render() {
    const { slotActions } = this.props
    const actions = slotActions.map(([text, handler], i) =>
        <SlotAction key={i} text={text} onClick={handler} />)

    return (<div>
      <IconButton icon={<SlotActionsIcon />} title='Slot actions'
          buttonRef={this._setSlotActionsButtonRef} onClick={this.onSlotActionsClick} />
      <SlotActionsOverlay open={this.state.slotActionsOverlayOpened}
          onDismiss={this.onCloseSlotActionsOverlay} anchor={this._slotActionsButtonRef}>
        {actions}
      </SlotActionsOverlay>
    </div>)
  }

  onSlotActionsClick = type => {
    this.setState({
      slotActionsOverlayOpened: true,
    })
  };

  onCloseSlotActionsOverlay = () => {
    this.setState({
      slotActionsOverlayOpened: false,
    })
  };
}

export class SlotActionsOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  };

  render() {
    const { children, open, onDismiss, anchor } = this.props

    return (<Popover open={open} onDismiss={onDismiss} anchor={anchor}
        anchorOriginVertical='top' anchorOriginHorizontal='right'
        popoverOriginVertical='top' popoverOriginHorizontal='right'>
      {
        (state, timings) => {
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
              transitionAppearTimeout={openDuration}
              transitionEnterTimeout={openDuration} transitionLeaveTimeout={closeDuration}>
            {
              state === 'opening' || state === 'opened' ?
                <SlotActionsContents key={'contents'} style={style}>
                  {children}
                </SlotActionsContents> :
                null
            }
          </TransitionGroup>)
        }
      }
    </Popover>)
  }
}

export class SlotActionsContents extends React.Component {
  static propTypes = {
    style: PropTypes.object,
  };

  render() {
    const { children, style } = this.props

    return (<div className={styles.slotActionsContents}>
      <div className={styles.slotActions} style={style}>
        { children }
      </div>
    </div>)
  }
}

export class SlotAction extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    onClick: PropTypes.func,
  };

  state = {
    active: false,
  };

  onMouseEnter = () => {
    this.setState({ active: true })
  };

  onMouseLeave = () => {
    this.setState({ active: false })
  };

  render() {
    const { text, onClick } = this.props
    const { active } = this.state

    return (
      <MenuItem
        text={text}
        onClick={onClick}
        active={active}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave} />
    )
  }
}
