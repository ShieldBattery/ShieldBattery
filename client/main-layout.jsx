import React from 'react'
import { connect } from 'react-redux'
import { replacePath } from 'redux-simple-router'
import siteSocket from './network/site-socket'
import styles from './main-layout.css'

import Divider from './material/left-nav/divider.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import RaisedButton from './material/raised-button.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialog from './dialogs/connected-dialog.jsx'

import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

import { createLobby, joinLobby } from './lobbies/action-creators'

function stateToProps(state) {
  return {
    auth: state.auth,
    lobby: state.lobby.name ? state.lobby : undefined,
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

// Pick a location to redirect the user to given props from the store, used if the user hits the
// index page
function doIndexRedirect({ lobby, chatChannels, whispers }) {
  if (lobby) {
    return replacePath(`/lobbies/${encodeURIComponent(lobby.name)}`)
  } else if (chatChannels.length) {
    return replacePath(`/chat/${encodeURIComponent(chatChannels[0].name)}`)
  } else if (whispers.length) {
    return replacePath(`/whispers/${encodeURIComponent(whispers[0].from)}`)
  } else {
    return replacePath('/chat/')
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  componentWillMount() {
    if (!this.props.children) {
      this.props.dispatch(doIndexRedirect(this.props))
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
      { this.props.children }
      <div className={styles.activities}>
        <div className={styles.activitiesAppBar} />
        <div className={styles.activitiesContent}>
          <RaisedButton color='primary' label='Create lobby' onClick={::this.onCreateLobbyClick} />
          <RaisedButton color='primary' label='Join lobby' onClick={::this.onJoinLobbyClick} />
        </div>
      </div>
      <ConnectedDialog />
    </div>)
  }

  onCreateLobbyClick() {
    this.props.dispatch(createLobby('baby\'s first lobby', 'c:\\lt.scm', 4))
  }

  onJoinLobbyClick() {
    this.props.dispatch(joinLobby('baby\'s first lobby'))
  }
}

export default MainLayout
