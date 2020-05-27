import React from 'react'
import { connect } from 'react-redux'
import { Link, Route, Switch } from 'react-router-dom'
import { replace } from 'connected-react-router'
import keycode from 'keycode'
import styled from 'styled-components'

import ActiveGame from './active-game/view.jsx'
import ActiveGameTitle from './active-game/app-bar-title.jsx'
import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivityOverlay from './activities/activity-overlay.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import AdminPanel from './admin/panel.jsx'
import AdminTitle from './admin/app-bar-title.jsx'
import AppBar from './app-bar/app-bar.jsx'
import ChatChannel from './chat/channel.jsx'
import ChatList from './chat/list.jsx'
import { ChatListTitle, ChatTitle } from './chat/app-bar-title.jsx'
import { ConditionalRoute } from './navigation/custom-routes.jsx'
import Divider from './material/left-nav/divider.jsx'
import EmailVerificationNotification from './auth/email-verification-notification.jsx'
import HotkeyedActivityButton from './activities/hotkeyed-activity-button.jsx'
import Index from './navigation/index.jsx'
import LeftNav from './material/left-nav/left-nav.jsx'
import LobbyView from './lobbies/view.jsx'
import LobbyTitle from './lobbies/app-bar-title.jsx'
import MenuItem from './material/menu/item.jsx'
import ProfileNavEntry from './profile/nav-entry.jsx'
import Section from './material/left-nav/section.jsx'
import Subheader from './material/left-nav/subheader.jsx'
import SubheaderButton from './material/left-nav/subheader-button.jsx'
import ConnectedDialogOverlay from './dialogs/connected-dialog-overlay.jsx'
import ConnectedSnackbar from './snackbars/connected-snackbar.jsx'
import SelfProfileOverlay from './profile/self-profile-overlay.jsx'
import Whisper from './whispers/whisper.jsx'
import WhispersTitle from './whispers/app-bar-title.jsx'

import AddIcon from './icons/material/ic_add_black_24px.svg'
import CancelMatchIcon from './icons/material/ic_cancel_black_24px.svg'
import ChangelogIcon from './icons/material/ic_new_releases_black_24px.svg'
import CreateGameIcon from './icons/material/ic_gavel_black_36px.svg'
import DownloadIcon from './icons/material/ic_get_app_black_36px.svg'
import FeedbackIcon from './icons/material/ic_feedback_black_24px.svg'
import FindMatchIcon from './icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import JoinGameIcon from './icons/material/ic_call_merge_black_36px.svg'
import LogoutIcon from './icons/material/ic_power_settings_new_black_24px.svg'
import MapsIcon from './icons/material/ic_terrain_black_24px.svg'
import ReplaysIcon from './icons/material/ic_movie_black_36px.svg'
import SettingsIcon from './icons/material/ic_settings_black_36px.svg'

import ActiveGameNavEntry from './active-game/nav-entry.jsx'
import ChatNavEntry from './chat/nav-entry.jsx'
import LobbyNavEntry from './lobbies/nav-entry.jsx'
import WhisperNavEntry from './whispers/nav-entry.jsx'

import { logOut } from './auth/auther'
import { isAdmin } from './admin/admin-permissions'
import { cancelFindMatch } from './matchmaking/action-creators'
import { openDialog } from './dialogs/action-creators'
import { openSnackbar } from './snackbars/action-creators'
import { openOverlay } from './activities/action-creators'
import { leaveChannel } from './chat/action-creators'
import { leaveLobby } from './lobbies/action-creators'
import { closeWhisperSession } from './whispers/action-creators'
import { isStarcraftHealthy } from './starcraft/is-starcraft-healthy'
import { openChangelogIfNecessary, openChangelog } from './changelog/action-creators'
import { IsAdminFilter } from './admin/admin-route-filters.jsx'
import { removeMap } from './maps/action-creators'

import { MULTI_CHANNEL, MATCHMAKING } from '../common/flags'

const KEY_C = keycode('c')
const KEY_F = keycode('f')
const KEY_J = keycode('j')
const KEY_M = keycode('m')
const KEY_R = keycode('r')
const KEY_S = keycode('s')

const Container = styled.div`
  display: flex;
  flex-direction: column;
`

const Layout = styled.div`
  display: flex;
  flex-grow: 1;
  height: calc(100% - 64px);
`

const Content = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
  overflow-x: hidden;
`

const LinksContainer = styled.div`
  width: 100%;
  padding: 0 12px;

  display: flex;
  justify-content: space-between;
`

const StyledMapsIcon = styled(MapsIcon)`
  width: 36px;
  height: 36px;
`

let activeGameRoute
let lobbyRoute
if (IS_ELECTRON) {
  activeGameRoute = <Route path='/active-game' component={ActiveGame} />
  lobbyRoute = <Route path='/lobbies/:lobby' component={LobbyView} />
}

function stateToProps(state) {
  return {
    activeGame: state.activeGame,
    auth: state.auth,
    inLobby: state.lobby.inLobby,
    lobby: state.lobby.inLobby
      ? { name: state.lobby.info.name, hasUnread: state.lobby.hasUnread }
      : null,
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
    router: state.router,
    matchmaking: state.matchmaking,
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  state = {
    profileOverlayOpened: false,
  }
  _profileEntryRef = null
  _setProfileEntryRef = elem => {
    this._profileEntryRef = elem
  }

  componentDidMount() {
    this.props.dispatch(openChangelogIfNecessary())
  }

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

  renderProfileOverlay() {
    return (
      <SelfProfileOverlay
        open={this.state.profileOverlayOpened}
        onDismiss={this.onCloseProfileOverlay}
        anchor={this._profileEntryRef}
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
      inGameplayActivity,
      chatChannels,
      whispers,
      router: {
        location: { pathname },
      },
    } = this.props

    let appBarTitle
    if (pathname.startsWith('/active-game')) {
      appBarTitle = <ActiveGameTitle />
    } else if (pathname.startsWith('/admin')) {
      appBarTitle = <AdminTitle />
    } else if (pathname === '/chat') {
      appBarTitle = <ChatListTitle />
    } else if (pathname.startsWith('/chat/')) {
      appBarTitle = <ChatTitle />
    } else if (pathname.startsWith('/lobbies')) {
      appBarTitle = <LobbyTitle />
    } else if (pathname.startsWith('/whispers')) {
      appBarTitle = <WhispersTitle />
    }

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
      isAdmin(auth) ? (
        <LinksContainer key='links'>
          <Link to='/admin'>Admin</Link>
        </LinksContainer>
      ) : null,
      <ProfileNavEntry
        key='profileEntry'
        user={auth.user.name}
        avatarTitle={auth.user.name}
        onProfileEntryClick={this.onProfileEntryClick}
        profileEntryRef={this._setProfileEntryRef}
      />,
    ]
    const findMatchButton = !this.props.matchmaking.isFinding ? (
      <HotkeyedActivityButton
        key='find-match'
        icon={<FindMatchIcon />}
        label='Find match'
        onClick={this.onFindMatchClick}
        disabled={inGameplayActivity}
        keycode={KEY_F}
        altKey={true}
      />
    ) : (
      <ActivityButton
        key='cancel-match'
        icon={<CancelMatchIcon />}
        label='Cancel'
        onClick={this.onCancelFindMatchClick}
      />
    )
    const activityButtons = IS_ELECTRON
      ? [
          findMatchButton,
          <HotkeyedActivityButton
            key='create-game'
            icon={<CreateGameIcon />}
            label='Create'
            onClick={this.onCreateLobbyClick}
            disabled={inGameplayActivity}
            keycode={KEY_C}
            altKey={true}
          />,
          <HotkeyedActivityButton
            key='join-game'
            icon={<JoinGameIcon />}
            label='Join'
            onClick={this.onJoinLobbyClick}
            keycode={KEY_J}
            altKey={true}
          />,
          <HotkeyedActivityButton
            key='maps'
            icon={<StyledMapsIcon />}
            label='Maps'
            onClick={this.onMapsClick}
            keycode={KEY_M}
            altKey={true}
          />,
          <HotkeyedActivityButton
            key='replays'
            icon={<ReplaysIcon />}
            label='Replays'
            onClick={this.onReplaysClick}
            keycode={KEY_R}
            altKey={true}
          />,
          <ActivitySpacer key='spacer' />,
          <HotkeyedActivityButton
            key='settings'
            icon={<SettingsIcon />}
            label='Settings'
            onClick={this.onSettingsClick}
            keycode={KEY_S}
            altKey={true}
          />,
        ]
      : [
          <ActivityButton
            key='download'
            icon={<DownloadIcon />}
            label='Download'
            onClick={this.onDownloadClick}
          />,
        ]

    return (
      <Container>
        <AppBar>{appBarTitle}</AppBar>
        {!auth.emailVerified ? <EmailVerificationNotification /> : null}
        <Layout>
          <LeftNav footer={footer}>
            {this.renderActiveGameNav()}
            {this.renderLobbyNav()}
            <Subheader button={MULTI_CHANNEL ? joinChannelButton : null}>Chat channels</Subheader>
            <Section>{channelNav}</Section>
            <Divider />
            <Subheader button={addWhisperButton}>Whispers</Subheader>
            <Section>{whisperNav}</Section>
          </LeftNav>
          <Content>
            <Switch>
              {activeGameRoute}
              <ConditionalRoute path='/admin' filters={[IsAdminFilter]} component={AdminPanel} />
              <Route path='/chat' exact={true} component={ChatList} />
              <Route path='/chat/:channel' component={ChatChannel} />
              {lobbyRoute}
              <Route path='/whispers/:target' component={Whisper} />
              {/* If no paths match, redirect the page to the "index". Note: this means that we
                  can't actually have a 404 page, but I don't think we really need one? */}
              <Index transitionFn={replace} />
            </Switch>
          </Content>
          <ActivityBar>{activityButtons}</ActivityBar>
          {this.renderProfileOverlay()}
          <ActivityOverlay />
          <ConnectedSnackbar />
          <ConnectedDialogOverlay />
        </Layout>
      </Container>
    )
  }

  onProfileEntryClick = () => {
    this.setState({
      profileOverlayOpened: true,
    })
  }

  onCloseProfileOverlay = () => {
    this.setState({
      profileOverlayOpened: false,
    })
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

  onSettingsClick = () => {
    this.props.dispatch(openDialog('settings'))
  }

  onLogOutClick = () => {
    this.onCloseProfileOverlay()
    this.props.dispatch(logOut().action)
  }

  onFindMatchClick = () => {
    if (!MATCHMAKING) {
      this.props.dispatch(openSnackbar({ message: 'Not implemented yet. Coming soon!' }))
    } else {
      if (!isStarcraftHealthy(this.props)) {
        this.props.dispatch(openDialog('starcraftHealth'))
      } else {
        this.props.dispatch(openOverlay('findMatch'))
      }
    }
  }

  onCancelFindMatchClick = () => {
    this.props.dispatch(cancelFindMatch())
  }

  onCreateLobbyClick = () => {
    if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog('starcraftHealth'))
    } else {
      this.props.dispatch(openOverlay('createLobby'))
    }
  }

  onJoinLobbyClick = () => {
    if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog('starcraftHealth'))
    } else {
      this.props.dispatch(openOverlay('joinLobby'))
    }
  }

  onLocalMapSelect = map => {
    this.props.dispatch(
      openOverlay('browseServerMaps', { ...this.serverMapsProps, uploadedMap: map }),
    )
  }

  onMapDetails = map => {
    this.props.dispatch(openDialog('mapDetails', { mapId: map.id }))
  }

  onRemoveMap = map => {
    this.props.dispatch(removeMap(map))
  }

  serverMapsProps = {
    title: 'Maps',
    onLocalMapSelect: this.onLocalMapSelect,
    onMapDetails: this.onMapDetails,
    onRemoveMap: this.onRemoveMap,
  }

  onMapsClick = () => {
    if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog('starcraftHealth'))
    } else {
      this.props.dispatch(openOverlay('browseServerMaps', this.serverMapsProps))
    }
  }

  onReplaysClick = () => {
    if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog('starcraftHealth'))
    } else {
      this.props.dispatch(openOverlay('watchReplay'))
    }
  }

  onDownloadClick = () => {
    this.props.dispatch(openDialog('download'))
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

export default MainLayout
