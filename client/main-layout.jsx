import React from 'react'
import { connect } from 'react-redux'
import siteSocket from './network/site-socket'
import auther from './auth/auther'
import { openDialog } from './dialogs/dialog-action-creator'
import styles from './main-layout.css'

import ActiveUserCount from './serverstatus/active-users.jsx'
import AppBar from './material/app-bar.jsx'
import Divider from './material/left-nav/divider.jsx'
import FlatButton from './material/flat-button.jsx'
import FontIcon from './material/font-icon.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialog from './dialogs/connected-dialog.jsx'

import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

function stateToProps(state) {
  return {
    auth: state.auth,
    lobby: {
      name: '5v3 BGH Comp Stomp',
    },
    chatChannels: [
      { name: 'doyoureallywantthem' },
      { name: 'teamliquid' },
      { name: 'x17' },
      { name: 'nohunters' },
    ],
    whispers: [
      { from: 'Pachi' },
    ],
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  componentDidMount() {
    siteSocket.connect()
  }

  componentWillUnmount() {
    siteSocket.disconnect()
  }

  render() {
    let lobbyElems
    if (this.props.lobby) {
      const lobby = this.props.lobby
      lobbyElems = [
        <Subheader key='lobby-header'>Lobby</Subheader>,
        <Section key='lobby-section'>
          <LobbyNavEntry key='lobby' lobby={lobby.name} />
        </Section>,
        <Divider key='lobby-divider'/>
      ]
    }

    const channels = this.props.chatChannels.map(
        channel => <ChatNavEntry key={channel.name} channel={channel.name} />)
    const whispers = this.props.whispers.map(
        whisper => <WhisperNavEntry key={whisper.from} user={whisper.from} />)

    return (<div className={styles.layout}>
      <LeftNav>
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
      <div className={styles.content}>
        <AppBar title='#teamliquid'>
          <ActiveUserCount />
          <FlatButton label={<FontIcon>account_circle</FontIcon>}
              onClick={::this.onLogOutClicked} />
          <FlatButton label={<FontIcon>settings</FontIcon>} onClick={::this.onSettingsClicked} />
          <FlatButton label={<FontIcon>more_vert</FontIcon>} />
        </AppBar>
        { this.props.children }
      </div>
      <div className={styles.actions}>
        <div className={styles.actionsBar} />
      </div>
      <ConnectedDialog />
    </div>)
  }

  onSettingsClicked() {
    this.props.dispatch(openDialog('settings'))
  }

  onLogOutClicked() {
    this.props.dispatch(auther.logOut().action)
  }
}

export default MainLayout
