import React from 'react'
import { connect } from 'react-redux'
import { Route, Switch } from 'react-router-dom'
import { replace, push } from 'connected-react-router'
import keycode from 'keycode'
import styled from 'styled-components'
import loadable from '@loadable/component'

import ActivityBar from './activities/activity-bar.jsx'
import ActivityButton from './activities/activity-button.jsx'
import ActivityOverlay from './activities/activity-overlay.jsx'
import ActivitySpacer from './activities/spacer.jsx'
import AdminTitle from './admin/app-bar-title.jsx'
import AppBar from './app-bar/app-bar.jsx'
import ChatChannel from './chat/channel.jsx'
import ChatList from './chat/list.jsx'
import { ChatListTitle, ChatTitle } from './chat/app-bar-title.jsx'
import { ConditionalRoute } from './navigation/custom-routes.jsx'
import ConnectedDialogOverlay from './dialogs/connected-dialog-overlay.jsx'
import ConnectedLeftNav from './navigation/connected-left-nav.jsx'
import ConnectedSnackbar from './snackbars/connected-snackbar.jsx'
import EmailVerificationNotification from './auth/email-verification-notification.jsx'
import HotkeyedActivityButton from './activities/hotkeyed-activity-button.jsx'
import Index from './navigation/index.jsx'
import LoadingIndicator from './progress/dots.jsx'
import LobbyView from './lobbies/view.jsx'
import LobbyTitle from './lobbies/app-bar-title.jsx'
import MatchmakingView from './matchmaking/view.jsx'
import MatchmakingTitle from './matchmaking/app-bar-title.jsx'
import Menu from './material/menu/menu.jsx'
import MenuItem from './material/menu/item.jsx'
import Whisper from './whispers/whisper.jsx'
import WhispersTitle from './whispers/app-bar-title.jsx'

import AdminIcon from './icons/material/ic_build_black_36px.svg'
import CreateGameIcon from './icons/material/ic_gavel_black_36px.svg'
import DownloadIcon from './icons/material/ic_get_app_black_36px.svg'
import FindMatchIcon from './icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import JoinGameIcon from './icons/material/ic_call_merge_black_36px.svg'
import MapsIcon from './icons/material/ic_terrain_black_24px.svg'
import ReplaysIcon from './icons/material/ic_movie_black_36px.svg'
import SettingsIcon from './icons/material/ic_settings_black_36px.svg'

import { isAdmin } from './admin/admin-permissions'
import { cancelFindMatch } from './matchmaking/action-creators'
import { openDialog } from './dialogs/action-creators'
import { openSnackbar } from './snackbars/action-creators'
import { openOverlay } from './activities/action-creators'
import { isStarcraftHealthy } from './starcraft/is-starcraft-healthy'
import { openChangelogIfNecessary } from './changelog/action-creators'
import { IsAdminFilter } from './admin/admin-route-filters.jsx'
import { removeMap } from './maps/action-creators'

import { MATCHMAKING } from '../common/flags'

import { Caption } from './styles/typography.js'
import { colorTextSecondary } from './styles/colors.js'
import { version as curVersion } from '../package.json'

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

const StyledMapsIcon = styled(MapsIcon)`
  width: 36px;
  height: 36px;
`

const VersionText = styled(Caption)`
  margin: 8px 0px 0px 0px;
  color: ${colorTextSecondary};
`

let lobbyRoute
let matchmakingRoute
if (IS_ELECTRON) {
  lobbyRoute = <Route path='/lobbies/:lobby' component={LobbyView} />
  matchmakingRoute = <Route path='/matchmaking' component={MatchmakingView} />
}

const LoadableAdminPanel = loadable(() => import('./admin/panel.jsx'), {
  // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
  // place?)
  fallback: <LoadingIndicator />,
})

function stateToProps(state) {
  return {
    auth: state.auth,
    inGameplayActivity: state.gameplayActivity.inGameplayActivity,
    starcraft: state.starcraft,
    router: state.router,
    matchmaking: state.matchmaking,
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  state = {
    searchingMatchOverlayOpen: false,
  }

  _searchingMatchButtonRef = React.createRef()

  componentDidMount() {
    this.props.dispatch(openChangelogIfNecessary())
  }

  renderSearchingMatchOverlay() {
    if (!this.props.matchmaking.isFinding || !IS_ELECTRON) return null

    return (
      <Menu
        open={this.state.searchingMatchOverlayOpen}
        onDismiss={this.onSearchingMatchOverlayClose}
        anchor={this._searchingMatchButtonRef.current}
        anchorOriginVertical='top'
        anchorOriginHorizontal='left'
        popoverOriginVertical='top'
        popoverOriginHorizontal='right'>
        <MenuItem
          key='cancel'
          text='Cancel'
          onClick={() => {
            this.onCancelFindMatchClick()
            this.onSearchingMatchOverlayClose()
          }}
        />
      </Menu>
    )
  }

  render() {
    const {
      auth,
      inGameplayActivity,
      router: {
        location: { pathname },
      },
    } = this.props

    let appBarTitle
    if (pathname.startsWith('/admin')) {
      appBarTitle = <AdminTitle />
    } else if (pathname === '/chat') {
      appBarTitle = <ChatListTitle />
    } else if (pathname.startsWith('/chat/')) {
      appBarTitle = <ChatTitle />
    } else if (pathname.startsWith('/lobbies')) {
      appBarTitle = <LobbyTitle />
    } else if (pathname.startsWith('/matchmaking')) {
      appBarTitle = <MatchmakingTitle />
    } else if (pathname.startsWith('/whispers')) {
      appBarTitle = <WhispersTitle />
    }

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
        key='searching-match'
        ref={this._searchingMatchButtonRef}
        icon={<FindMatchIcon />}
        glowing={true}
        label='Searching...'
        onClick={this.onSearchingMatchOverlayOpen}
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
          isAdmin(auth) ? (
            <ActivityButton
              key='admin'
              icon={<AdminIcon />}
              label='Admin'
              onClick={this.onAdminClick}
            />
          ) : null,
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
          <ActivitySpacer key='spacer' />,
          isAdmin(auth) ? (
            <ActivityButton
              key='admin'
              icon={<AdminIcon />}
              label='Admin'
              onClick={this.onAdminClick}
            />
          ) : null,
        ]

    return (
      <Container>
        <AppBar>{appBarTitle}</AppBar>
        {!auth.emailVerified ? <EmailVerificationNotification /> : null}
        <Layout>
          <ConnectedLeftNav />
          <Content>
            <Switch>
              <ConditionalRoute
                path='/admin'
                filters={[IsAdminFilter]}
                component={LoadableAdminPanel}
              />
              <Route path='/chat' exact={true} component={ChatList} />
              <Route path='/chat/:channel' component={ChatChannel} />
              {lobbyRoute}
              {matchmakingRoute}
              <Route path='/whispers/:target' component={Whisper} />
              {/* If no paths match, redirect the page to the "index". Note: this means that we
                  can't actually have a 404 page, but I don't think we really need one? */}
              <Index transitionFn={replace} />
            </Switch>
          </Content>
          <ActivityBar>
            {activityButtons}
            <VersionText>v{curVersion}</VersionText>
          </ActivityBar>
          {this.renderSearchingMatchOverlay()}
          <ActivityOverlay />
          <ConnectedSnackbar />
          <ConnectedDialogOverlay />
        </Layout>
      </Container>
    )
  }

  onSearchingMatchOverlayOpen = () => {
    this.setState({ searchingMatchOverlayOpen: true })
  }

  onSearchingMatchOverlayClose = () => {
    this.setState({ searchingMatchOverlayOpen: false })
  }

  onSettingsClick = () => {
    this.props.dispatch(openDialog('settings'))
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

  onAdminClick = () => {
    this.props.dispatch(push('/admin'))
  }
}

export default MainLayout
