import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import { routerActions } from 'react-router-redux'
import keycode from 'keycode'
import { goToIndex } from './navigation/action-creators'
import styles from './main-layout.css'

import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivityOverlay from './activities/activity-overlay.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import Divider from './material/left-nav/divider.jsx'
import HotkeyedActivityButton from './activities/hotkeyed-activity-button.jsx'
import IconButton from './material/icon-button.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialogOverlay from './dialogs/connected-dialog-overlay.jsx'
import ConnectedSnackbar from './snackbars/connected-snackbar.jsx'
import ActiveUserCount from './serverstatus/active-users.jsx'
import SelfProfileOverlay, { ProfileAction } from './profile/self-profile-overlay.jsx'
import WindowControls from './window-controls/window-controls.jsx'

import AddIcon from './icons/material/ic_add_black_24px.svg'
import CancelMatchIcon from './icons/material/ic_cancel_black_24px.svg'
import ChangelogIcon from './icons/material/ic_new_releases_black_24px.svg'
import CreateGameIcon from './icons/material/ic_gavel_black_36px.svg'
import DownloadIcon from './icons/material/ic_get_app_black_36px.svg'
import FeedbackIcon from './icons/material/ic_feedback_black_24px.svg'
import FindMatchIcon from './icons/material/ic_cake_black_36px.svg'
import JoinGameIcon from './icons/material/ic_call_merge_black_36px.svg'
import LogoutIcon from './icons/material/ic_power_settings_new_black_24px.svg'
import ReplaysIcon from './icons/material/ic_movie_black_36px.svg'
import SettingsIcon from './icons/material/ic_settings_black_36px.svg'

import ActiveGameNavEntry from './active-game/nav-entry.jsx'
import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

import { logOut } from './auth/auther'
import { isAdmin } from './admin/admin-permissions'
import { cancelFindMatch } from './matchmaking/action-creators'
import { openDialog } from './dialogs/dialog-action-creator'
import { openOverlay } from './activities/action-creators'
import { leaveChannel } from './chat/action-creators'
import { leaveLobby } from './lobbies/action-creators'
import { closeWhisperSession } from './whispers/action-creators'
import { isPsiHealthy } from './network/is-psi-healthy'
import { openChangelogIfNecessary, openChangelog } from './changelog/action-creators'

import { DEV_INDICATOR, MULTI_CHANNEL } from '../app/common/flags'

const KEY_C = keycode('c')
const KEY_F = keycode('f')
const KEY_J = keycode('j')
const KEY_S = keycode('s')

function stateToProps(state) {
  return {
    activeGame: state.activeGame,
    auth: state.auth,
    inLobby: state.lobby.inLobby,
    lobby: state.lobby.inLobby ?
        { name: state.lobby.info.name, hasUnread: state.lobby.hasUnread } : null,
    inGameplayActivity: state.gameplayActivity.inGameplayActivity,
    chatChannels: state.chat.channels.map(c => ({
      name: c,
      hasUnread: state.chat.byName.get(c.toLowerCase()).hasUnread,
    })),
    whispers: state.whispers.sessions.map(s => ({
      name: s,
      hasUnread: state.whispers.byName.get(s.toLowerCase()).hasUnread,
    })),
    starcraft: state.starcraft,
    routing: state.routing,
    matchmaking: state.matchmaking,
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  state = {
    avatarOverlayOpened: false,
  };
  _avatarButtonRef = null;
  _setAvatarButtonRef = elem => { this._avatarButtonRef = elem };

  componentWillMount() {
    if (!this.props.children) {
      this.props.dispatch(goToIndex(routerActions.replace))
    }
  }

  componentWillReceiveProps(nextProps) {
    if (!nextProps.children) {
      nextProps.dispatch(goToIndex(routerActions.replace))
    }
  }

  componentDidMount() {
    this.props.dispatch(openChangelogIfNecessary())
  }

  renderLobbyNav() {
    if (!this.props.inLobby || process.webpackEnv.SB_ENV !== 'electron') return null

    const {
      lobby: { name, hasUnread },
      routing: { location: { pathname: currentPath } }
    } = this.props
    return [
      <Subheader key='lobby-header'>Lobby</Subheader>,
      <Section key='lobby-section'>
        <LobbyNavEntry key='lobby' lobby={name} currentPath={currentPath} hasUnread={hasUnread}
            onLeaveClick={this.onLeaveLobbyClick}/>
      </Section>,
      <Divider key='lobby-divider'/>
    ]
  }

  renderActiveGameNav() {
    if (!this.props.activeGame.isActive || process.webpackEnv.SB_ENV !== 'electron') return null

    return [
      <Section key='active-game-section'>
        <ActiveGameNavEntry key='active-game' currentPath={this.props.routing.location.pathname} />
      </Section>,
      <Divider key='active-game-divider' />,
    ]
  }

  renderAvatarOverlay() {
    return (<SelfProfileOverlay
        open={this.state.avatarOverlayOpened}
        onDismiss={this.onCloseProfileOverlay}
        anchor={this._avatarButtonRef}
        user={this.props.auth.user.name}>
      {
        window._sbFeedbackUrl ?
            <ProfileAction icon={<FeedbackIcon />}
                text='Send feedback' onClick={this.onFeedbackClick}/> :
            null
      }
      <ProfileAction icon={<ChangelogIcon />} text='View changelog'
          onClick={this.onChangelogClick}/>
      <ProfileAction icon={<LogoutIcon />} text='Log out' onClick={this.onLogOutClick}/>
    </SelfProfileOverlay>)
  }

  render() {
    const {
      inGameplayActivity,
      chatChannels,
      whispers,
      routing: { location: { pathname } }
    } = this.props

    const channelNav = chatChannels.map(c =>
        <ChatNavEntry key={c.name}
            channel={c.name}
            currentPath={pathname}
            hasUnread={c.hasUnread}
            onLeave={this.onChannelLeave}/>)
    const joinChannelButton = <IconButton icon={<AddIcon/>} title='Join a channel'
        className={styles.subheaderButton} onClick={this.onJoinChannelClick} />
    const whisperNav = whispers.map(w =>
        <WhisperNavEntry key={w.name}
            user={w.name}
            currentPath={pathname}
            hasUnread={w.hasUnread}
            onClose={this.onWhisperClose}/>)
    const addWhisperButton = <IconButton icon={<AddIcon/>} title='Start a whisper'
        className={styles.subheaderButton} onClick={this.onAddWhisperClick} />
    const footer = [
      DEV_INDICATOR ? <span key='dev' className={styles.devIndicator}>Dev Mode</span> : null,
      <ActiveUserCount key='userCount' className={styles.userCount}/>,
      isAdmin(this.props.auth) ? <p key='adminPanel'><Link to='/admin'>Admin</Link></p> : null,
    ]
    const findMatchButton = !this.props.matchmaking.isFinding ?
        <ActivityButton key='find-match' icon={<FindMatchIcon />} label='Find match'
            onClick={this.onFindMatchClick} disabled={inGameplayActivity} keycode={KEY_F}
            altKey={true} /> :
        <ActivityButton key='cancel-match' icon={<CancelMatchIcon />} label='Cancel'
            onClick={this.onCancelFindMatchClick} />
    const activityButtons = process.webpackEnv.SB_ENV === 'electron' ? [
      findMatchButton,
      <HotkeyedActivityButton key='create-game' icon={<CreateGameIcon />} label='Create'
          onClick={this.onCreateLobbyClick} disabled={inGameplayActivity} keycode={KEY_C}
          altKey={true} />,
      <HotkeyedActivityButton key='join-game' icon={<JoinGameIcon />} label='Join'
          onClick={this.onJoinLobbyClick} keycode={KEY_J} altKey={true} />,
      <ActivityButton key='replays' icon={<ReplaysIcon />} label='Replays'
          onClick={this.onReplaysClick} />,
      <ActivitySpacer key='spacer' />,
      <HotkeyedActivityButton key='settings' icon={<SettingsIcon />} label='Settings'
          onClick={this.onSettingsClick} keycode={KEY_S} altKey={true} />,
    ] : [
      <ActivityButton key='download' icon={<DownloadIcon />} label='Download'
          onClick={this.onDownloadClick} />
    ]

    return (<div>
      <WindowControls className={styles.windowControls} />
      <ConnectedDialogOverlay className={styles.layout} containerClassName={styles.content}>
        <LeftNav footer={footer}>
          {this.renderActiveGameNav()}
          {this.renderLobbyNav()}
          <Subheader button={MULTI_CHANNEL ? joinChannelButton : null}>Chat channels</Subheader>
          <Section>
            {channelNav}
          </Section>
          <Divider/>
          <Subheader button={addWhisperButton}>Whispers</Subheader>
          <Section>
            {whisperNav}
          </Section>
        </LeftNav>
        { this.props.children }
        <ActivityBar user={this.props.auth.user.name} avatarTitle={this.props.auth.user.name}
            onAvatarClick={this.onAvatarClick} avatarButtonRef={this._setAvatarButtonRef}>
          {activityButtons}
        </ActivityBar>
        { this.renderAvatarOverlay() }
        <ActivityOverlay />
        <ConnectedSnackbar />
      </ConnectedDialogOverlay>
    </div>)
  }

  onAvatarClick = () => {
    this.setState({
      avatarOverlayOpened: true
    })
  };

  onCloseProfileOverlay = () => {
    this.setState({
      avatarOverlayOpened: false
    })
  };

  onJoinChannelClick = () => {
    this.props.dispatch(openDialog('channel'))
  };

  onChannelLeave = channel => {
    this.props.dispatch(leaveChannel(channel))
  };

  onAddWhisperClick = () => {
    this.props.dispatch(openDialog('whispers'))
  };

  onWhisperClose = user => {
    this.props.dispatch(closeWhisperSession(user))
  };

  onLeaveLobbyClick = () => {
    this.props.dispatch(leaveLobby())
  };

  onSettingsClick = () => {
    this.props.dispatch(openDialog('settings'))
  };

  onLogOutClick = () => {
    this.onCloseProfileOverlay()
    this.props.dispatch(logOut().action)
  };

  onFindMatchClick = () => {
    if (!isPsiHealthy(this.props)) {
      this.props.dispatch(openDialog('psiHealth'))
    } else {
      this.props.dispatch(openOverlay('findMatch'))
    }
  };

  onCancelFindMatchClick = () => {
    this.props.dispatch(cancelFindMatch())
  };

  onCreateLobbyClick = () => {
    if (!isPsiHealthy(this.props)) {
      this.props.dispatch(openDialog('psiHealth'))
    } else {
      this.props.dispatch(openOverlay('createLobby'))
    }
  };

  onJoinLobbyClick = () => {
    if (!isPsiHealthy(this.props)) {
      this.props.dispatch(openDialog('psiHealth'))
    } else {
      this.props.dispatch(openOverlay('joinLobby'))
    }
  };

  onReplaysClick = () => {
    if (!isPsiHealthy(this.props)) {
      this.props.dispatch(openDialog('psiHealth'))
    } else {
      this.props.dispatch(openOverlay('watchReplay'))
    }
  };

  onDownloadClick = () => {
    this.props.dispatch(openDialog('download'))
  };

  onFeedbackClick = () => {
    this.onCloseProfileOverlay()
    window.open(window._sbFeedbackUrl, '_blank')
  };

  onChangelogClick = () => {
    this.onCloseProfileOverlay()
    this.props.dispatch(openChangelog())
  };
}

export default MainLayout
