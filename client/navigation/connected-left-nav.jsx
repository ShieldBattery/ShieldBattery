import React from 'react'
import { connect } from 'react-redux'

import Divider from '../material/left-nav/divider'
import LeftNav from '../material/left-nav/left-nav'
import MenuDivider from '../material/menu/divider'
import MenuItem from '../material/menu/item'
import Section from '../material/left-nav/section'
import Subheader from '../material/left-nav/subheader'
import SubheaderButton from '../material/left-nav/subheader-button'
import SelfProfileOverlay from '../profile/self-profile-overlay'

import AddIcon from '../icons/material/ic_add_black_24px.svg'
import ChangelogIcon from '../icons/material/ic_new_releases_black_24px.svg'
import EditIcon from '../icons/material/edit-24px.svg'
import FeedbackIcon from '../icons/material/ic_feedback_black_24px.svg'
import LogoutIcon from '../icons/material/ic_power_settings_new_black_24px.svg'

import ChatNavEntry from '../chat/nav-entry'
import GameActivityNavEntry from '../active-game/game-activity-nav-entry'
import LobbyNavEntry from '../lobbies/nav-entry'
import ProfileNavEntry from '../profile/nav-entry'
import SearchingMatchNavEntry from '../matchmaking/searching-match-nav-entry'
import WhisperNavEntry from '../whispers/nav-entry'

import { logOut } from '../auth/action-creators'
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
    chatChannels: state.chat.channels.map(c => ({
      name: c,
      hasUnread: state.chat.byName.get(c.toLowerCase()).hasUnread,
    })),
    lobby: state.lobby,
    matchmaking: state.matchmaking,
    router: state.router,
    whispers: state.whispers.sessions.map(s => ({
      name: s,
      hasUnread: state.whispers.byName.get(s.toLowerCase()).hasUnread,
    })),
  }
}

@connect(stateToProps)
class ConnectedLeftNav extends React.Component {
  state = {
    profileOverlayOpen: false,
  }

  _profileEntryRef = React.createRef()

  renderLobby() {
    const {
      lobby: {
        info: { name },
        hasUnread,
        inLobby,
      },
      router: {
        location: { pathname: currentPath },
      },
    } = this.props

    if (!inLobby || !IS_ELECTRON) return null

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

  renderLoadingGame() {
    const {
      lobby,
      matchmaking,
      router: {
        location: { pathname: currentPath },
      },
    } = this.props
    const isLoading = lobby.info.isLoading || matchmaking.isLoading

    if (!isLoading || !IS_ELECTRON) return null

    let link
    let title
    if (lobby.info.isLoading) {
      link = `/lobbies/${encodeURIComponent(lobby.info.name)}/loading-game`
      title = 'Custom game'
    } else if (matchmaking.isLoading) {
      title = `Ranked ${matchmaking.match.type}`

      if (matchmaking.isSelectingMap) {
        link = '/matchmaking/map-selection'
      } else if (matchmaking.isCountingDown) {
        link = '/matchmaking/countdown'
      } else if (matchmaking.isStarting) {
        link = '/matchmaking/game-starting'
      }
    } else {
      return null
    }

    return [
      <Section key='loading-game-section'>
        <GameActivityNavEntry
          key='loading-game'
          link={link}
          currentPath={currentPath}
          title={title}
          subtitle='Loading...'
        />
      </Section>,
      <Divider key='loading-game-divider' />,
    ]
  }

  renderActiveGame() {
    const {
      activeGame: { isActive, info: gameInfo },
      router: {
        location: { pathname: currentPath },
      },
    } = this.props

    if (!isActive || !gameInfo || !IS_ELECTRON) return null

    let link
    let title
    if (gameInfo.type === 'lobby') {
      link = `/lobbies/${encodeURIComponent(gameInfo.extra.lobby.info.name)}/active-game`
      title = 'Custom game'
    } else if (gameInfo.type === 'matchmaking') {
      link = '/matchmaking/active-game'
      title = `Ranked ${gameInfo.extra.match.type}`
    } else {
      return null
    }

    return [
      <Section key='active-game-section'>
        <GameActivityNavEntry
          key='active-game'
          link={link}
          currentPath={currentPath}
          title={title}
          subtitle='Game in progress...'
        />
      </Section>,
      <Divider key='active-game-divider' />,
    ]
  }

  renderSearchingMatch() {
    const {
      matchmaking: { isFinding, searchStartTime },
    } = this.props
    if (!isFinding || searchStartTime < 0 || !IS_ELECTRON) return null

    return [
      <Section key='searching-match-section'>
        <SearchingMatchNavEntry
          startTime={searchStartTime}
          onCancelSearch={this.onCancelFindMatchClick}
        />
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
        <MenuItem icon={<EditIcon />} text='Edit account' onClick={this.onAccountClick} />
        <MenuDivider />
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
        {this.renderSearchingMatch()}
        {this.renderLoadingGame()}
        {this.renderActiveGame()}
        {this.renderLobby()}
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

  onAccountClick = () => {
    this.onCloseProfileOverlay()
    this.props.dispatch(openDialog('account'))
  }
}

export default ConnectedLeftNav
