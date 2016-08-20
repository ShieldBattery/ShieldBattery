import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import { routerActions } from 'react-router-redux'
import { goToIndex } from './navigation/action-creators'
import styles from './main-layout.css'

import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivityOverlay from './activities/activity-overlay.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import FontIcon from './material/font-icon.jsx'
import Divider from './material/left-nav/divider.jsx'
import IconButton from './material/icon-button.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialogOverlay from './dialogs/connected-dialog-overlay.jsx'
import ConnectedSnackbar from './snackbars/connected-snackbar.jsx'
import ActiveUserCount from './serverstatus/active-users.jsx'
import SelfProfileOverlay, { ProfileAction } from './profile/self-profile-overlay.jsx'
import Portal from './material/portal.jsx'

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
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  state = {
    avatarOverlayOpened: false,
  };
  _handleWhisperClose = ::this.onWhisperClose;

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

    const { lobby: { name, hasUnread } } = this.props
    return [
      <Subheader key='lobby-header'>Lobby</Subheader>,
      <Section key='lobby-section'>
        <LobbyNavEntry key='lobby' lobby={name} hasUnread={hasUnread} />
      </Section>,
      <Divider key='lobby-divider'/>
    ]
  }

  renderActiveGameNav() {
    if (!this.props.activeGame.isActive) return null

    return [
      <Section key='active-game-section'><ActiveGameNavEntry key='active-game' /></Section>,
      <Divider key='active-game-divider' />,
    ]
  }

  renderAvatarOverlay() {
    if (!this.state.avatarOverlayOpened) return null

    return (<Portal onDismiss={this.onCloseProfileOverlay} open={true}>
      <SelfProfileOverlay key='overlay' className={styles.profileOverlay}
          user={this.props.auth.user.name}>
        <ProfileAction icon={<FontIcon>power_settings_new</FontIcon>} text='Log out'
            onClick={this.onLogOutClicked} />
      </SelfProfileOverlay>
    </Portal>)
  }

  render() {
    const channels = this.props.chatChannels.map(
        c => <ChatNavEntry key={c.name} channel={c.name} hasUnread={c.hasUnread}/>)
    const whispers = this.props.whispers.map(w => <WhisperNavEntry key={w.name}
        user={w.name} hasUnread={w.hasUnread} onClose={this._handleWhisperClose}/>)
    const addWhisperButton = <IconButton icon='add' title='Start a conversation'
        className={styles.subheaderButton} onClick={::this.onAddWhisperClicked} />
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
          {channels}
        </Section>
        <Divider/>
        <Subheader button={addWhisperButton}>Whispers</Subheader>
        <Section>
          {whispers}
        </Section>
      </LeftNav>
      { this.props.children }
      <ActivityBar user={this.props.auth.user.name} avatarTitle={this.props.auth.user.name}
          onAvatarClick={this.onAvatarClick}>
        <ActivityButton icon='cake' label='Find match' onClick={::this.onFindMatchClick} />
        <ActivityButton icon='gavel' label='Create' onClick={::this.onCreateLobbyClick} />
        <ActivityButton icon='call_merge' label='Join' onClick={::this.onJoinLobbyClick} />
        <ActivityButton icon='movie' label='Replays' onClick={::this.onReplaysClick} />
        <ActivitySpacer />
        { window._sbFeedbackUrl ?
          <ActivityButton icon='feedback' label='Feedback' onClick={::this.onFeedbackClicked} /> :
          null }
        <ActivityButton icon='settings' label='Settings' onClick={::this.onSettingsClicked} />
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

  onAddWhisperClicked() {
    this.props.dispatch(openDialog('whispers'))
  }

  onWhisperClose(user) {
    this.props.dispatch(closeWhisperSession(user))
  }

  onSettingsClicked() {
    this.props.dispatch(openDialog('settings'))
  }

  onLogOutClicked = () => {
    this.props.dispatch(auther.logOut().action)
  };

  onFindMatchClick() {
    this.props.dispatch(openSnackbar({
      message: 'Not implemented yet. Coming soon!',
    }))
  }

  onCreateLobbyClick() {
    if (!isPsiHealthy(this.props)) {
      this.props.dispatch(openDialog('psiHealth'))
    } else {
      this.props.dispatch(openOverlay('createLobby'))
    }
  }

  onJoinLobbyClick() {
    if (!isPsiHealthy(this.props)) {
      this.props.dispatch(openDialog('psiHealth'))
    } else {
      this.props.dispatch(openOverlay('joinLobby'))
    }
  }

  onReplaysClick() {
    this.props.dispatch(openSnackbar({
      message: 'Not implemented yet. Coming soon!',
    }))
  }

  onFeedbackClicked() {
    window.open(window._sbFeedbackUrl, '_blank')
  }
}

export default MainLayout
