import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import { routerActions } from 'react-router-redux'
import { goToIndex } from './navigation/action-creators'
import keycode from 'keycode'
import styles from './main-layout.css'

import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivityOverlay from './activities/activity-overlay.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import FontIcon from './material/font-icon.jsx'
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

import ActiveGameNavEntry from './active-game/nav-entry.jsx'
import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

import auther from './auth/auther'
import { isAdmin } from './admin/admin-utils'
import { openDialog } from './dialogs/dialog-action-creator'
import { openSnackbar } from './snackbars/action-creators'
import { openOverlay } from './activities/action-creators'
import { closeWhisperSession } from './whispers/action-creators'
import { isPsiHealthy } from './network/is-psi-healthy'

const KEY_C = keycode('c')
const KEY_J = keycode('j')
const KEY_S = keycode('s')

function stateToProps(state) {
  return {
    activeGame: state.activeGame,
    auth: state.auth,
    inLobby: state.lobby.inLobby,
    lobby: state.lobby.inLobby ?
        { name: state.lobby.info.name, hasUnread: state.lobby.hasUnread } : null,
    chatChannels: state.chat.channels.map(c => ({
      name: c,
      hasUnread: state.chat.byName.get(c).hasUnread,
    })),
    whispers: state.whispers.sessions.map(s => ({
      name: s,
      hasUnread: state.whispers.byName.get(s.toLowerCase()).hasUnread,
    })),
    network: state.network,
    upgrade: state.upgrade,
    routing: state.routing,
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  state = {
    avatarOverlayOpened: false,
  };

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

  renderLobbyNav() {
    if (!this.props.inLobby) return null

    const {
      lobby: { name, hasUnread },
      routing: { location: { pathname: currentPath } }
    } = this.props
    return [
      <Subheader key='lobby-header'>Lobby</Subheader>,
      <Section key='lobby-section'>
        <LobbyNavEntry key='lobby' lobby={name} currentPath={currentPath} hasUnread={hasUnread} />
      </Section>,
      <Divider key='lobby-divider'/>
    ]
  }

  renderActiveGameNav() {
    if (!this.props.activeGame.isActive) return null

    return [
      <Section key='active-game-section'>
        <ActiveGameNavEntry key='active-game' currentPath={this.props.routing.location.pathname} />
      </Section>,
      <Divider key='active-game-divider' />,
    ]
  }

  renderAvatarOverlay() {
    return (<SelfProfileOverlay className={styles.profileOverlay}
        open={this.state.avatarOverlayOpened}
        onDismiss={this.onCloseProfileOverlay}
        user={this.props.auth.user.name}>
      <ProfileAction icon={<FontIcon>power_settings_new</FontIcon>} text='Log out'
          onClick={this.onLogOutClick} />
    </SelfProfileOverlay>)
  }

  render() {
    const { inLobby, chatChannels, whispers, routing: { location: { pathname } } } = this.props
    const channelNav = chatChannels.map(c =>
        <ChatNavEntry key={c.name}
            channel={c.name}
            currentPath={pathname}
            hasUnread={c.hasUnread}/>)
    const whisperNav = whispers.map(w =>
        <WhisperNavEntry key={w.name}
            user={w.name}
            currentPath={pathname}
            hasUnread={w.hasUnread}
            onClose={this.onWhisperClose}/>)
    const addWhisperButton = <IconButton icon='add' title='Start a conversation'
        className={styles.subheaderButton} onClick={this.onAddWhisperClick} />
    const footer = isAdmin(this.props.auth) ? [
      <ActiveUserCount key='userCount' className={styles.userCount}/>,
      <p key='adminPanel'><Link to='/admin'>Admin</Link></p>
    ] : <ActiveUserCount className={styles.userCount}/>

    return (<ConnectedDialogOverlay className={styles.layout}>
      <LeftNav footer={footer}>
        {this.renderActiveGameNav()}
        {this.renderLobbyNav()}
        <Subheader>Chat channels</Subheader>
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
          onAvatarClick={this.onAvatarClick}>
        <ActivityButton icon='cake' label='Find match' onClick={this.onFindMatchClick} />
        <HotkeyedActivityButton icon='gavel' label='Create' onClick={this.onCreateLobbyClick}
            disabled={inLobby} keycode={KEY_C} altKey={true} />
        <HotkeyedActivityButton icon='call_merge' label='Join' onClick={this.onJoinLobbyClick}
            disabled={inLobby} keycode={KEY_J} altKey={true} />
        <ActivityButton icon='movie' label='Replays' onClick={this.onReplaysClick} />
        <ActivitySpacer />
        { window._sbFeedbackUrl ?
          <ActivityButton icon='feedback' label='Feedback' onClick={this.onFeedbackClick} /> :
          null }
        <HotkeyedActivityButton icon='settings' label='Settings' onClick={this.onSettingsClick}
            keycode={KEY_S} altKey={true} />
      </ActivityBar>
      { this.renderAvatarOverlay() }
      <ActivityOverlay />
      <ConnectedSnackbar />
    </ConnectedDialogOverlay>)
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

  onAddWhisperClick = () => {
    this.props.dispatch(openDialog('whispers'))
  };

  onWhisperClose = user => {
    this.props.dispatch(closeWhisperSession(user))
  };

  onSettingsClick = () => {
    this.props.dispatch(openDialog('settings'))
  };

  onLogOutClick = () => {
    this.props.dispatch(auther.logOut().action)
  };

  onFindMatchClick = () => {
    this.props.dispatch(openSnackbar({
      message: 'Not implemented yet. Coming soon!',
    }))
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
    this.props.dispatch(openSnackbar({
      message: 'Not implemented yet. Coming soon!',
    }))
  };

  onFeedbackClick = () => {
    window.open(window._sbFeedbackUrl, '_blank')
  };
}

export default MainLayout
