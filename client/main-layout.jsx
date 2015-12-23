import React from 'react'
import { connect } from 'react-redux'
import siteSocket from './network/site-socket'

import AppBar from './material/app-bar.jsx'
import Divider from './material/left-nav/divider.jsx'
import Entry from './material/left-nav/entry.jsx'
import FlatButton from './material/flat-button.jsx'
import FontIcon from './material/font-icon.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import ConnectedDialog from './dialogs/connected-dialog.jsx'
import { openDialog } from './dialogs/dialog-action-creator'

function stateToProps(state) {
  return {
    auth: state.auth,
    lobby: {
      name: '5v3 BGH Comp Stomp',
    },
    chatChannels: [
      { name: '#doyoureallywantthem' },
      { name: '#teamliquid', active: true },
      { name: '#x17' },
      { name: '#nohunters' },
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
      lobbyElems = [
        <Subheader key='lobby-header'>Lobby</Subheader>,
        <Section key='lobby-section'>
          <Entry active={this.props.lobby.active}>{this.props.lobby.name}</Entry>
        </Section>,
        <Divider key='lobby-divider'/>
      ]
    }

    const channels = this.props.chatChannels.map(
        channel => <Entry key={channel.name} active={channel.active}>{channel.name}</Entry>)
    const whispers = this.props.whispers.map(
        whisper => <Entry key={whisper.from} active={whisper.active}>{whisper.from}</Entry>)

    return (<div className='flex-row'>
      <LeftNav>
        {lobbyElems}
        <Subheader>Chat channels</Subheader>
        <Section>
          {channels}
          <Entry>
            <FontIcon>add_circle</FontIcon>
            <span>Join another</span>
          </Entry>
        </Section>
        <Divider/>
        <Subheader>Whispers</Subheader>
        <Section>
          {whispers}
        </Section>
      </LeftNav>
      <div className='flex-fit'>
        <AppBar title='#teamliquid'>
          <FlatButton label={<FontIcon>more_vert</FontIcon>} />
          <FlatButton label={<FontIcon>settings</FontIcon>} onClick={::this.onSettingsClicked} />
        </AppBar>
        { this.props.children }
      </div>
      <ConnectedDialog />
    </div>)
  }

  onSettingsClicked() {
    this.props.dispatch(openDialog('settings'))
  }
}

export default MainLayout
