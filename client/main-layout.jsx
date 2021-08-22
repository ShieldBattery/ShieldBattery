import loadable from '@loadable/component'
import keycode from 'keycode'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { Route, Switch, useLocation } from 'wouter'
import { MatchmakingType } from '../common/matchmaking'
import { EMAIL_VERIFICATION_ID, NotificationType } from '../common/notifications'
import { openOverlay } from './activities/action-creators'
import ActivityBar from './activities/activity-bar'
import { ActivityButton } from './activities/activity-button'
import ActivityOverlay from './activities/activity-overlay'
import ActivitySpacer from './activities/spacer'
import { IsAdminFilter } from './admin/admin-route-filters'
import AdminTitle from './admin/app-bar-title'
import AppBar from './app-bar/app-bar'
import { openChangelogIfNecessary } from './changelog/action-creators'
import { ChatListTitle, ChatTitle } from './chat/app-bar-title'
import ChatChannel from './chat/channel'
import ChatList from './chat/list'
import { openDialog } from './dialogs/action-creators'
import { ConnectedDialogOverlay } from './dialogs/connected-dialog-overlay'
import { DialogType } from './dialogs/dialog-type'
import LadderIcon from './icons/material/emoji_events_black_36px.svg'
import JoinGameIcon from './icons/material/ic_call_merge_black_36px.svg'
import CreateGameIcon from './icons/material/ic_gavel_black_36px.svg'
import DownloadIcon from './icons/material/ic_get_app_black_36px.svg'
import ReplaysIcon from './icons/material/ic_movie_black_36px.svg'
import MapsIcon from './icons/material/ic_terrain_black_36px.svg'
import SettingsIcon from './icons/material/settings_black_24px.svg'
import FindMatchIcon from './icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { LadderTitle } from './ladder/app-bar-title'
import { Ladder } from './ladder/ladder'
import LobbyTitle from './lobbies/app-bar-title'
import LobbyView from './lobbies/view'
import { regenMapImage, removeMap } from './maps/action-creators'
import { cancelFindMatch } from './matchmaking/action-creators'
import MatchmakingTitle from './matchmaking/app-bar-title'
import MatchmakingDisabledOverlay from './matchmaking/matchmaking-disabled-overlay'
import MatchmakingSearchingOverlay from './matchmaking/matchmaking-searching-overlay'
import MatchmakingView from './matchmaking/view'
import { IconButton } from './material/button'
import ConnectedLeftNav from './navigation/connected-left-nav'
import { ConditionalRoute } from './navigation/custom-routes'
import Index from './navigation/index'
import { push, replace } from './navigation/routing'
import { addNotification } from './notifications/action-creators'
import { NotificationsButton } from './notifications/activity-bar-entry'
import NotificationPopups from './notifications/notifications-popup'
import { PartyTitle } from './parties/app-bar-title'
import { PartyView } from './parties/party-view'
import { ConnectedUserProfilePage } from './profile/user-profile'
import LoadingIndicator from './progress/dots'
import ConnectedSnackbar from './snackbars/connected-snackbar'
import { isShieldBatteryHealthy, isStarcraftHealthy } from './starcraft/is-starcraft-healthy'
import { colorTextSecondary } from './styles/colors'
import { caption } from './styles/typography'
import WhispersTitle from './whispers/app-bar-title'
import Whisper from './whispers/whisper'

const curVersion = __WEBPACK_ENV.VERSION

const KEY_C = keycode('c')
const KEY_D = keycode('d')
const KEY_F = keycode('f')
const KEY_J = keycode('j')
const KEY_M = keycode('m')
const KEY_R = keycode('r')

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

const VersionText = styled.div`
  ${caption};
  margin: 8px 0px 0px 0px;
  color: ${colorTextSecondary};
  letter-spacing: 1.25px;
`

let lobbyRoute = <></>
let matchmakingRoute = <></>
let partyRoute = <></>
if (IS_ELECTRON) {
  lobbyRoute = <Route path='/lobbies/:lobby/:rest*' component={LobbyView} />
  matchmakingRoute = <Route path='/matchmaking/:rest*' component={MatchmakingView} />
  partyRoute = <Route path='/parties/:partyId/:rest*' component={PartyView} />
}

const LoadableAdminPanel = loadable(() => import('./admin/panel'), {
  // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
  // place?)
  fallback: <LoadingIndicator />,
})

const MiniActivityButtonsContainer = styled.div`
  width: 100%;
  display: flex;
`

const FadedSettingsIcon = styled(SettingsIcon)`
  color: ${colorTextSecondary};
`

/**
 * Tracks if this is the first time this user has logged in on this client. Pretty dumb, if we need
 * more smarts we can add it as a Context var or put it in the store or something.
 */
let firstLoggedIn = true

function AppBarTitle() {
  // NOTE(tec27): Using this hook ensures this gets re-rendered if the location changes
  const [location] = useLocation()

  // TODO(tec27): Just use the same routes from the layout for this? (need a way to split that into
  // two fragments, one with the content components, one with the title components)
  if (location.startsWith('/admin')) {
    return <AdminTitle />
  } else if (location === '/chat') {
    return <ChatListTitle />
  } else if (location.startsWith('/chat/')) {
    return <ChatTitle />
  } else if (/^\/ladder(\/|$)/.test(location)) {
    return <LadderTitle />
  } else if (/^\/lobbies(\/|$)/.test(location)) {
    return <LobbyTitle />
  } else if (/^\/matchmaking(\/|$)/.test(location)) {
    return <MatchmakingTitle />
  } else if (/^\/parties(\/|$)/.test(location)) {
    return <PartyTitle />
  } else if (/^\/whispers(\/|$)/.test(location)) {
    return <WhispersTitle />
  }

  return null
}

function stateToProps(state) {
  return {
    auth: state.auth,
    inGameplayActivity: state.gameplayActivity.inGameplayActivity,
    starcraft: state.starcraft,
    matchmaking: state.matchmaking,
    matchmakingPreferences: state.matchmakingPreferences,
    matchmakingStatus: state.matchmakingStatus,
    serverStatus: state.serverStatus,
  }
}

@connect(stateToProps)
class MainLayout extends React.Component {
  state = {
    matchmakingDisabledOverlayOpen: false,
    searchingMatchOverlayOpen: false,
  }

  _findMatchButtonRef = React.createRef()
  _searchingMatchButtonRef = React.createRef()

  componentDidMount() {
    this.props.dispatch(openChangelogIfNecessary())
    if (firstLoggedIn) {
      firstLoggedIn = false
      if (!this.props.auth.user.emailVerified) {
        this.props.dispatch(
          addNotification({
            id: EMAIL_VERIFICATION_ID,
            type: NotificationType.EmailVerification,
          }),
        )
      }
    }
  }

  componentWillUnmount() {
    firstLoggedIn = true
  }

  componentDidUpdate(prevProps) {
    // TODO(2Pac): Rethink  this UI for partially disabled matchmaking
    if (!IS_ELECTRON) return
    const { matchmakingDisabledOverlayOpen } = this.state
    const prevMatchmakingStatus = prevProps.matchmakingStatus.types.get(MatchmakingType.Match1v1)
    const currMatchmakingStatus = this.props.matchmakingStatus.types.get(MatchmakingType.Match1v1)

    if (
      prevMatchmakingStatus &&
      !prevMatchmakingStatus.enabled &&
      currMatchmakingStatus &&
      currMatchmakingStatus.enabled &&
      matchmakingDisabledOverlayOpen
    ) {
      this.onMatchmakingDisabledOverlayClose()
      this.props.dispatch(openOverlay('findMatch'))
    }
  }

  // TODO(2Pac): Rethink this UI for partially disabled matchmaking
  renderMatchmakingDisabledOverlay() {
    if (!IS_ELECTRON) return null

    const matchmakingStatus = this.props.matchmakingStatus.types.get(MatchmakingType.Match1v1)
    return (
      <MatchmakingDisabledOverlay
        open={this.state.matchmakingDisabledOverlayOpen}
        anchor={this._findMatchButtonRef.current}
        matchmakingStatus={matchmakingStatus}
        onDismiss={this.onMatchmakingDisabledOverlayClose}
      />
    )
  }

  renderSearchingMatchOverlay() {
    const {
      matchmaking: { isFinding, searchStartTime },
      matchmakingPreferences: { lastQueuedMatchmakingType, typeToPreferences },
    } = this.props
    const preferences = typeToPreferences.get(lastQueuedMatchmakingType)
    if (!isFinding || !preferences || !IS_ELECTRON) return null

    return (
      <MatchmakingSearchingOverlay
        open={this.state.searchingMatchOverlayOpen}
        anchor={this._searchingMatchButtonRef.current}
        startTime={searchStartTime}
        matchmakingType={preferences.matchmakingType}
        selectedRace={preferences.race}
        onCancelSearch={() => {
          this.onCancelFindMatchClick()
          this.onSearchingMatchOverlayClose()
        }}
        onDismiss={this.onSearchingMatchOverlayClose}
      />
    )
  }

  render() {
    const { inGameplayActivity, serverStatus } = this.props
    const lobbyCount = serverStatus.lobbyCount > 0 ? serverStatus.lobbyCount : undefined

    const findMatchButton = !this.props.matchmaking.isFinding ? (
      <ActivityButton
        key='find-match'
        ref={this._findMatchButtonRef}
        icon={<FindMatchIcon />}
        label='Find match'
        onClick={this.onFindMatchClick}
        disabled={inGameplayActivity}
        hotkey={{ keyCode: KEY_F, altKey: true }}
      />
    ) : (
      <ActivityButton
        key='searching-match'
        ref={this._searchingMatchButtonRef}
        icon={<FindMatchIcon />}
        glowing={true}
        label='Finding…'
        onClick={this.onSearchingMatchOverlayOpen}
        hotkey={{ keyCode: KEY_F, altKey: true }}
      />
    )
    const activityButtons = IS_ELECTRON
      ? [
          findMatchButton,
          <ActivityButton
            key='create-game'
            icon={<CreateGameIcon />}
            label='Create'
            onClick={this.onCreateLobbyClick}
            disabled={inGameplayActivity}
            hotkey={{ keyCode: KEY_C, altKey: true }}
          />,
          <ActivityButton
            key='join-game'
            icon={<JoinGameIcon />}
            label='Join'
            onClick={this.onJoinLobbyClick}
            hotkey={{ keyCode: KEY_J, altKey: true }}
            count={lobbyCount}
          />,
          <ActivityButton
            key='maps'
            icon={<StyledMapsIcon />}
            label='Maps'
            onClick={this.onMapsClick}
            hotkey={{ keyCode: KEY_M, altKey: true }}
          />,
          <ActivityButton
            key='replays'
            icon={<ReplaysIcon />}
            label='Replays'
            onClick={this.onReplaysClick}
            hotkey={{ keyCode: KEY_R, altKey: true }}
          />,
          <ActivityButton
            key='ladder'
            icon={<LadderIcon />}
            label='Ladder'
            onClick={this.onLadderClick}
            hotkey={{ keyCode: KEY_D, altKey: true }}
          />,
          <ActivitySpacer key='spacer' />,
        ]
      : [
          <ActivityButton
            key='download'
            icon={<DownloadIcon />}
            label='Download'
            onClick={this.onDownloadClick}
          />,
          <ActivityButton
            key='ladder'
            icon={<LadderIcon />}
            label='Ladder'
            onClick={this.onLadderClick}
            hotkey={{ keyCode: KEY_D, altKey: true }}
          />,
          <ActivitySpacer key='spacer' />,
        ]

    return (
      <Container>
        <AppBar>
          <AppBarTitle />
        </AppBar>
        <Layout>
          <ConnectedLeftNav />
          <Content>
            <Switch>
              <ConditionalRoute
                path='/admin/:rest*'
                filters={[IsAdminFilter]}
                component={LoadableAdminPanel}
              />
              <Route path='/chat' component={ChatList} />
              <Route path='/chat/:channel' component={ChatChannel} />
              <Route path='/ladder/:rest*' component={Ladder} />
              {lobbyRoute}
              {matchmakingRoute}
              {partyRoute}
              <Route path='/users/:userId/:username/:subPage?'>
                {params => (
                  <ConnectedUserProfilePage
                    userId={Number(params.userId)}
                    username={params.username}
                    subPage={params.subPage}
                  />
                )}
              </Route>
              <Route path='/whispers/:target' component={Whisper} />
              {/* If no paths match, redirect the page to the "index". */}
              <Route>
                <Index transitionFn={replace} />
              </Route>
            </Switch>
          </Content>
          <ActivityBar>
            {activityButtons}

            <MiniActivityButtonsContainer key='mini-buttons'>
              <NotificationsButton />
              {/* TODO(tec27): Hotkey this to Alt+S */}
              <IconButton
                key='settings'
                icon={<FadedSettingsIcon />}
                title='Settings'
                onClick={this.onSettingsClick}
              />
            </MiniActivityButtonsContainer>

            <VersionText key='version'>v{curVersion}</VersionText>
          </ActivityBar>
          {this.renderMatchmakingDisabledOverlay()}
          {this.renderSearchingMatchOverlay()}
          <ActivityOverlay />
          <ConnectedSnackbar />
          <ConnectedDialogOverlay />
          <NotificationPopups />
        </Layout>
      </Container>
    )
  }

  onMatchmakingDisabledOverlayClose = () => {
    this.setState({ matchmakingDisabledOverlayOpen: false })
  }

  onSearchingMatchOverlayOpen = () => {
    this.setState({ searchingMatchOverlayOpen: true })
  }

  onSearchingMatchOverlayClose = () => {
    this.setState({ searchingMatchOverlayOpen: false })
  }

  onSettingsClick = () => {
    this.props.dispatch(openDialog(DialogType.Settings))
  }

  onFindMatchClick = () => {
    if (!isShieldBatteryHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.ShieldBatteryHealth))
    } else if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.StarcraftHealth))
    } else {
      const matchmakingStatus = this.props.matchmakingStatus.types.get('1v1')

      if (matchmakingStatus && matchmakingStatus.enabled) {
        this.props.dispatch(openOverlay('findMatch'))
      } else {
        this.setState({ matchmakingDisabledOverlayOpen: true })
      }
    }
  }

  onCancelFindMatchClick = () => {
    this.props.dispatch(cancelFindMatch())
  }

  onCreateLobbyClick = () => {
    if (!isShieldBatteryHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.ShieldBatteryHealth))
    } else if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.StarcraftHealth))
    } else {
      this.props.dispatch(openOverlay('createLobby'))
    }
  }

  onJoinLobbyClick = () => {
    if (!isShieldBatteryHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.ShieldBatteryHealth))
    } else if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.StarcraftHealth))
    } else {
      this.props.dispatch(openOverlay('joinLobby'))
    }
  }

  onMapUpload = map => {
    this.props.dispatch(
      openOverlay('browseServerMaps', { ...this.serverMapsProps, uploadedMap: map }),
    )
  }

  onMapDetails = map => {
    this.props.dispatch(openDialog(DialogType.MapDetails, { mapId: map.id }))
  }

  onRemoveMap = map => {
    this.props.dispatch(removeMap(map))
  }

  onRegenMapImage = map => {
    this.props.dispatch(regenMapImage(map))
  }

  serverMapsProps = {
    title: 'Maps',
    onMapUpload: this.onMapUpload,
    onMapSelect: this.onMapDetails,
    onMapDetails: this.onMapDetails,
    onRemoveMap: this.onRemoveMap,
    onRegenMapImage: this.onRegenMapImage,
  }

  onMapsClick = () => {
    if (!isShieldBatteryHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.ShieldBatteryHealth))
    } else if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.StarcraftHealth))
    } else {
      this.props.dispatch(openOverlay('browseServerMaps', this.serverMapsProps))
    }
  }

  onReplaysClick = () => {
    if (!isShieldBatteryHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.ShieldBatteryHealth))
    } else if (!isStarcraftHealthy(this.props)) {
      this.props.dispatch(openDialog(DialogType.StarcraftHealth))
    } else {
      this.props.dispatch(openOverlay('watchReplay'))
    }
  }

  onDownloadClick = () => {
    this.props.dispatch(openDialog('download'))
  }

  onLadderClick = () => {
    push('/ladder')
  }
}

export default MainLayout
