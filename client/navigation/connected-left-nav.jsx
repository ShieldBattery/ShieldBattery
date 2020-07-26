import React from 'react'
import { connect } from 'react-redux'

import Divider from '../material/left-nav/divider.jsx'
import LeftNav from '../material/left-nav/left-nav.jsx'
import MenuItem from '../material/menu/item.jsx'
import ProfileNavEntry from '../profile/nav-entry.jsx'
import SearchingMatchNavEntry from '../matchmaking/searching-match-nav-entry.jsx'
import Section from '../material/left-nav/section.jsx'
import Subheader from '../material/left-nav/subheader.jsx'
import SubheaderButton from '../material/left-nav/subheader-button.jsx'
import SelfProfileOverlay from '../profile/self-profile-overlay.jsx'

import AddIcon from '../icons/material/ic_add_black_24px.svg'
import ChangelogIcon from '../icons/material/ic_new_releases_black_24px.svg'
import FeedbackIcon from '../icons/material/ic_feedback_black_24px.svg'
import LogoutIcon from '../icons/material/ic_power_settings_new_black_24px.svg'

import ActiveGameNavEntry from '../active-game/nav-entry.jsx'
import ChatNavEntry from '../chat/nav-entry.jsx'
import LobbyNavEntry from '../lobbies/nav-entry.jsx'
import WhisperNavEntry from '../whispers/nav-entry.jsx'

import { logOut } from '../auth/auther'
import { cancelFindMatch } from '../matchmaking/action-creators'
import { openDialog } from '../dialogs/action-creators'
import { leaveChannel } from '../chat/action-creators'
import { leaveLobby } from '../lobbies/action-creators'
import { closeWhisperSession } from '../whispers/action-creators'
import { openChangelog } from '../changelog/action-creators'

import { MULTI_CHANNEL } from '../../common/flags'

function stateToProps(state) {
  return {
    activeGame: state.activeGame,
    auth: state.auth,
    inLobby: state.lobby.inLobby,
    lobby: state.lobby.inLobby
      ? { name: state.lobby.info.name, hasUnread: state.lobby.hasUnread }
      : null,
    chatChannels: state.chat.channels.map(c => ({
      name: c,
      hasUnread: state.chat.byName.get(c.toLowerCase()).hasUnread,
    })),
    whispers: state.whispers.sessions.map(s => ({
      name: s,
      hasUnread: state.whispers.byName.get(s.toLowerCase()).hasUnread,
    })),
    router: state.router,
    matchmaking: state.matchmaking,
  }
}

@connect(stateToProps)
class ConnectedLeftNav extends React.Component {
  state = {
    profileOverlayOpen: false,
  }

  _profileEntryRef = React.createRef()

  renderLobbyNav() {
    if (!this.props.inLobby || !IS_ELECTRON) return null

    const {
      lobby: { name, hasUnread },
      router: {
        location: { pathname: currentPath },
      },
    } = this.props
    return [
      <Subheader key='lobby-header'>Lobby</Subheader>,
      <Section key='lobby-section'>
        <LobbyNavEntry
          key='lobby'
          lobby={name}
          currentPath={currentPath}
          hasUnread={hasUnread}
          onLeaveClick={this.onLeaveLobbyClick}
        />
      </Section>,
      <Divider key='lobby-divider' />,
    ]
  }

  renderActiveGameNav() {
    if (!this.props.activeGame.isActive || !IS_ELECTRON) return null

    return [
      <Section key='active-game-section'>
        <ActiveGameNavEntry key='active-game' currentPath={this.props.router.location.pathname} />
      </Section>,
      <Divider key='active-game-divider' />,
    ]
  }

  renderSearchingMatchNav() {
    if (!this.props.matchmaking.isFinding || !IS_ELECTRON) return null

    return [
      <Section key='searching-match-section'>
        <SearchingMatchNavEntry onCancelSearch={this.onCancelFindMatchClick} />
      </Section>,
      <Divider key='searching-match-divider' />,
    ]
  }

  renderProfileOverlay() {
    return (
      <SelfProfileOverlay
        open={this.state.profileOverlayOpen}
        onDismiss={this.onCloseProfileOverlay}
        anchor={this._profileEntryRef.current}
        user={this.props.auth.user.name}>
        {window._sbFeedbackUrl ? (
          <MenuItem icon={<FeedbackIcon />} text='Send feedback' onClick={this.onFeedbackClick} />
        ) : null}
        <MenuItem icon={<ChangelogIcon />} text='View changelog' onClick={this.onChangelogClick} />
        <MenuItem icon={<LogoutIcon />} text='Log out' onClick={this.onLogOutClick} />
      </SelfProfileOverlay>
    )
  }

  render() {
    const {
      auth,
      chatChannels,
      whispers,
      router: {
        location: { pathname },
      },
    } = this.props

    const channelNav = chatChannels.map(c => (
      <ChatNavEntry
        key={c.name}
        channel={c.name}
        currentPath={pathname}
        hasUnread={c.hasUnread}
        onLeave={this.onChannelLeave}
      />
    ))
    const joinChannelButton = (
      <SubheaderButton
        icon={<AddIcon />}
        title='Join a channel'
        onClick={this.onJoinChannelClick}
      />
    )
    const whisperNav = whispers.map(w => (
      <WhisperNavEntry
        key={w.name}
        user={w.name}
        currentPath={pathname}
        hasUnread={w.hasUnread}
        onClose={this.onWhisperClose}
      />
    ))
    const addWhisperButton = (
      <SubheaderButton
        icon={<AddIcon />}
        title='Start a whisper'
        onClick={this.onAddWhisperClick}
      />
    )
    const footer = [
      <ProfileNavEntry
        key='profileEntry'
        ref={this._profileEntryRef}
        user={auth.user.name}
        avatarTitle={auth.user.name}
        onProfileEntryClick={this.onProfileEntryClick}
      />,
    ]

    return (
      <LeftNav footer={footer}>
        {this.renderSearchingMatchNav()}
        {this.renderActiveGameNav()}
        {this.renderLobbyNav()}
        <Subheader button={MULTI_CHANNEL ? joinChannelButton : null}>Chat channels</Subheader>
        <Section>{channelNav}</Section>
        <Divider />
        <Subheader button={addWhisperButton}>Whispers</Subheader>
        <Section>{whisperNav}</Section>
        {this.renderProfileOverlay()}
      </LeftNav>
    )
  }

  onProfileEntryClick = () => {
    this.setState({ profileOverlayOpen: true })
  }

  onCloseProfileOverlay = () => {
    this.setState({ profileOverlayOpen: false })
  }

  onJoinChannelClick = () => {
    this.props.dispatch(openDialog('channel'))
  }

  onChannelLeave = channel => {
    this.props.dispatch(leaveChannel(channel))
  }

  onAddWhisperClick = () => {
    this.props.dispatch(openDialog('whispers'))
  }

  onWhisperClose = user => {
    this.props.dispatch(closeWhisperSession(user))
  }

  onLeaveLobbyClick = () => {
    this.props.dispatch(leaveLobby())
  }

  onLogOutClick = () => {
    this.onCloseProfileOverlay()
    this.props.dispatch(logOut().action)
  }

  onCancelFindMatchClick = () => {
    this.props.dispatch(cancelFindMatch())
  }

  onFeedbackClick = () => {
    this.onCloseProfileOverlay()
    window.open(window._sbFeedbackUrl, '_blank')
  }

  onChangelogClick = () => {
    this.onCloseProfileOverlay()
    this.props.dispatch(openChangelog())
  }
}

export default ConnectedLeftNav
