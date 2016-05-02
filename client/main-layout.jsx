import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import { routeActions } from 'redux-simple-router'
import { goToIndex } from './navigation/action-creators'
import styles from './main-layout.css'

import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivityOverlay from './activities/activity-overlay.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import Divider from './material/left-nav/divider.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialogOverlay from './dialogs/connected-dialog-overlay.jsx'
import ConnectedSnackbar from './snackbars/connected-snackbar.jsx'
import ActiveUserCount from './serverstatus/active-users.jsx'

import ActiveGameNavEntry from './active-game/nav-entry.jsx'
import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

import auther from './auth/auther'
import { isAdmin } from './admin/admin-utils'
import { openDialog } from './dialogs/dialog-action-creator'
import { openSnackbar } from './snackbars/action-creators'
import { openOverlay } from './activities/action-creators'
import { needsUpgrade } from './network/needs-upgrade'

function stateToProps(state) {
  return {
    activeGame: state.activeGame,
    auth: state.auth,
    inLobby: state.lobby.inLobby,
    lobbyName: state.lobby.inLobby ? state.lobby.info.name : null,
    chatChannels: state.chat.channels,
    whispers: state.whispers,
    network: state.network,
    upgrade: state.upgrade,
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  componentWillMount() {
    if (!this.props.children) {
      this.props.dispatch(goToIndex(routeActions.replace))
    }
  }

  componentWillReceiveProps(nextProps) {
    if (!nextProps.children) {
      nextProps.dispatch(goToIndex(routeActions.replace))
    }
  }


  renderLobbyNav() {
    if (!this.props.inLobby) return null

    const lobbyName = this.props.lobbyName
    return [
      <Subheader key='lobby-header'>Lobby</Subheader>,
      <Section key='lobby-section'>
        <LobbyNavEntry key='lobby' lobby={lobbyName} />
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

  render() {
    const channels = this.props.chatChannels.map(
        channel => <ChatNavEntry key={channel} channel={channel} />)
    const whispers = this.props.whispers.map(
        whisper => <WhisperNavEntry key={whisper.from} user={whisper.from} />)
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
        <Subheader>Whispers</Subheader>
        <Section>
          {whispers}
        </Section>
      </LeftNav>
      { this.props.children }
      <ActivityBar user={this.props.auth.user.name} avatarTitle={'Log out'}
          onAvatarClick={::this.onLogOutClicked}>
        <ActivityButton icon='cake' label='Find match' onClick={::this.onFindMatchClick} />
        <ActivityButton icon='gavel' label='Create' onClick={::this.onCreateLobbyClick} />
        <ActivityButton icon='call_merge' label='Join' onClick={::this.onJoinLobbyClick} />
        <ActivityButton icon='movie' label='Replays' onClick={::this.onReplaysClick} />
        <ActivitySpacer />
        <ActivityButton icon='settings' label='Settings' onClick={::this.onSettingsClicked} />
      </ActivityBar>
      <ActivityOverlay />
      <ConnectedSnackbar />
    </ConnectedDialogOverlay>)
  }

  onSettingsClicked() {
    this.props.dispatch(openDialog('settings'))
  }

  onLogOutClicked() {
    this.props.dispatch(auther.logOut().action)
  }

  onFindMatchClick() {
    this.props.dispatch(openSnackbar({
      message: 'Not implemented yet. Coming soon!',
    }))
  }

  onCreateLobbyClick() {
    if (needsUpgrade(this.props)) {
      this.props.dispatch(openDialog('upgrade'))
    } else {
      this.props.dispatch(openOverlay('createLobby'))
    }
  }

  onJoinLobbyClick() {
    if (needsUpgrade(this.props)) {
      this.props.dispatch(openDialog('upgrade'))
    } else {
      this.props.dispatch(openOverlay('joinLobby'))
    }
  }

  onReplaysClick() {
    this.props.dispatch(openSnackbar({
      message: 'Not implemented yet. Coming soon!',
    }))
  }
}

export default MainLayout
