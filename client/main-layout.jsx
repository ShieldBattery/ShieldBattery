import React from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
import { goToIndex } from './navigation/action-creators'
import siteSocket from './network/site-socket'
import styles from './main-layout.css'

import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import Divider from './material/left-nav/divider.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialogOverlay from './dialogs/connected-dialog-overlay.jsx'
import ActiveUserCount from './serverstatus/active-users.jsx'

import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

import auther from './auth/auther'
import { openDialog } from './dialogs/dialog-action-creator'
import { joinLobby } from './lobbies/action-creators'

function stateToProps(state) {
  return {
    auth: state.auth,
    lobbyName: state.lobby.name,
    chatChannels: state.chatChannels,
    whispers: state.whispers,
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

  componentDidMount() {
    siteSocket.connect()
  }

  componentWillUnmount() {
    siteSocket.disconnect()
  }

  render() {
    let lobbyElems
    if (this.props.lobbyName) {
      const lobbyName = this.props.lobbyName
      lobbyElems = [
        <Subheader key='lobby-header'>Lobby</Subheader>,
        <Section key='lobby-section'>
          <LobbyNavEntry key='lobby' lobby={lobbyName} />
        </Section>,
        <Divider key='lobby-divider'/>
      ]
    }

    const channels = this.props.chatChannels.map(
        channel => <ChatNavEntry key={channel.name} channel={channel.name} />)
    const whispers = this.props.whispers.map(
        whisper => <WhisperNavEntry key={whisper.from} user={whisper.from} />)

    return (<ConnectedDialogOverlay className={styles.layout}>
      <LeftNav footer={<ActiveUserCount className={styles.userCount}/>}>
        {lobbyElems}
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
        <ActivityButton icon='cake' label='Find match' />
        <ActivityButton icon='gavel' label='Create' onClick={::this.onCreateLobbyClick} />
        <ActivityButton icon='call_merge' label='Join' onClick={::this.onJoinLobbyClick} />
        <ActivityButton icon='movie' label='Replays' onClick={::this.onJoinLobbyClick} />
        <ActivitySpacer />
        <ActivityButton icon='settings' label='Settings' onClick={::this.onSettingsClicked} />
      </ActivityBar>
    </ConnectedDialogOverlay>)
  }

  onSettingsClicked() {
    this.props.dispatch(openDialog('settings'))
  }

  onLogOutClicked() {
    this.props.dispatch(auther.logOut().action)
  }

  onCreateLobbyClick() {
    this.props.dispatch(openDialog('createLobbyOverlay'))
  }

  onJoinLobbyClick() {
    this.props.dispatch(joinLobby('baby\'s first lobby'))
  }
}

export default MainLayout
