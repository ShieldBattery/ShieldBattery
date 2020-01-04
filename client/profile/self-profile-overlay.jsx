import React from 'react'
import PropTypes from 'prop-types'
import TransitionGroup from 'react-addons-css-transition-group'
import Avatar from '../avatars/avatar.jsx'
import styles from './self-profile-overlay.css'

import Popover from '../material/popover.jsx'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

export default class SelfProfileOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    user: PropTypes.string.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  render() {
    const { user, children, open, onDismiss, anchor } = this.props

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='bottom'
        anchorOriginHorizontal='left'
        popoverOriginVertical='bottom'
        popoverOriginHorizontal='left'>
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
              transitionAppearTimeout={openDelay + openDuration}
              transitionEnterTimeout={openDuration}
              transitionLeaveTimeout={closeDuration}>
              {state === 'opening' || state === 'opened' ? (
                <SelfProfileContents key={'contents'} user={user} style={style}>
                  {children}
                </SelfProfileContents>
              ) : null}
            </TransitionGroup>
          )
        }}
      </Popover>
    )
  }
}

export class SelfProfileContents extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    style: PropTypes.object,
  }

  render() {
    const { user, children, style } = this.props

    return (
      <div className={styles.contents}>
        <div className={styles.header} style={style}>
          <Avatar className={styles.avatar} user={user} />
          <h3 className={styles.username}>{user}</h3>
        </div>
        <div className={styles.actions} style={style}>
          {children}
        </div>
      </div>
    )
  }
}
