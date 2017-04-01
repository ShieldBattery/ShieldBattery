import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './channel.css'

import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import Popover from '../material/popover.jsx'
import TextField from '../material/text-field.jsx'
import {
  composeValidators,
  maxLength,
  regex,
  required,
} from '../forms/validators'

import { joinChannel, navigateToChannel } from './action-creators'
import {
  CHANNEL_MAXLENGTH,
  CHANNEL_PATTERN,
} from '../../app/common/constants'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

export default class JoinChannelOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  };

  render() {
    const { children, open, onDismiss, anchor } = this.props

    return (<Popover open={open} onDismiss={onDismiss} anchor={anchor}
        anchorOriginVertical='top' anchorOriginHorizontal='left'
        popoverOriginVertical='top' popoverOriginHorizontal='left'>
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
                <JoinChannelContents key={'contents'} style={style}>
                  {children}
                </JoinChannelContents> :
                null
            }
          </TransitionGroup>)
        }
      }
    </Popover>)
  }
}

export class JoinChannelContents extends React.Component {
  static propTypes = {
    style: PropTypes.object,
  };

  render() {
    const { children, style } = this.props

    return (<div className={styles.joinChannelContents} style={style}>
      <div className={styles.joinChannelActions} style={style}>
        { children }
      </div>
    </div>)
  }
}

const channelValidator = composeValidators(
  required('Enter a channel name'),
  maxLength(CHANNEL_MAXLENGTH, `Enter at most ${CHANNEL_MAXLENGTH} characters`),
  regex(CHANNEL_PATTERN, 'Channel name contains invalid characters'))

@form({
  channel: channelValidator,
})
class JoinChannelForm extends React.Component {
  render() {
    const { onSubmit, bindInput, inputRef } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <TextField {...bindInput('channel')} label='Channel name' floatingLabel={true} ref={inputRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: 'off',
            tabIndex: 0,
          }} />
    </form>)
  }
}

@connect()
export class JoinChannel extends React.Component {
  static propTypes = {
    onJoinedChannel: PropTypes.func,
  }

  _autoFocusTimer = null;
  _form = null;
  _setForm = elem => { this._form = elem };
  _input = null;
  _setInput = elem => { this._input = elem };

  componentDidMount() {
    this._autoFocusTimer = setTimeout(() => this._doAutoFocus(), 450)
  }

  componentWillUnmount() {
    if (this._autoFocusTimer) {
      clearTimeout(this._autoFocusTimer)
      this._autoFocusTimer = null
    }
  }

  _doAutoFocus() {
    this._autoFocusTimer = null
    this._input.focus()
  }

  renderFeaturedChannels() {
    const featuredChannels = [
      'ShieldBattery',
    ]

    const channels = featuredChannels.map(channel => <div key={channel}
        className={styles.featuredChannel} onClick={() => this.onFeaturedChannelClick(channel)}>
      #{channel}
    </div>)
    return channels
  }

  render() {
    return (<div className={styles.joinChannel}>
      <div className={styles.joinChannelForm}>
        <JoinChannelForm ref={this._setForm} inputRef={this._setInput} model={{}}
            onSubmit={this.onSubmit} />
        <FlatButton className={styles.joinChannelButton} labelClassName={styles.joinChannelLabel}
            label='Join' onClick={this.onJoinChannel} />
      </div>
      <div className={styles.featuredTitle}>Featured channels</div>
      { this.renderFeaturedChannels() }
    </div>)
  }

  onJoinChannel = () => {
    this._form.submit()
  };

  onSubmit = () => {
    if (this.props.onJoinedChannel) {
      this.props.onJoinedChannel()
    }
    const channel = this._form.getModel().channel
    this.props.dispatch(joinChannel(channel))
    this.props.dispatch(navigateToChannel(channel))
  };

  onFeaturedChannelClick = channel => {
    if (this.props.onJoinedChannel) {
      this.props.onJoinedChannel()
    }
    this.props.dispatch(joinChannel(channel))
    this.props.dispatch(navigateToChannel(channel))
  };
}
