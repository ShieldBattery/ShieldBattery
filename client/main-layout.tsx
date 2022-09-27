import keycode from 'keycode'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { MapInfoJson } from '../common/maps'
import { EMAIL_VERIFICATION_ID, NotificationType } from '../common/notifications'
import { ReduxAction } from './action-types'
import { openOverlay } from './activities/action-creators'
import ActivityBar from './activities/activity-bar'
import { ActivityButton } from './activities/activity-button'
import ActivityOverlay from './activities/activity-overlay'
import ActivitySpacer from './activities/spacer'
import { IsAdminFilter } from './admin/admin-route-filters'
import { openChangelogIfNecessary } from './changelog/action-creators'
import { ChannelRouteComponent } from './chat/route'
import { openDialog } from './dialogs/action-creators'
import { DialogType } from './dialogs/dialog-type'
import { DispatchFunction } from './dispatch-registry'
import { GamesRouteComponent } from './games/route'
import JoinGameIcon from './icons/material/call_merge-36px.svg'
import LadderIcon from './icons/material/emoji_events-36px.svg'
import CreateGameIcon from './icons/material/gavel-36px.svg'
import DownloadIcon from './icons/material/get_app-36px.svg'
import ReplaysIcon from './icons/material/movie-36px.svg'
import SettingsIcon from './icons/material/settings-24px.svg'
import MapsIcon from './icons/material/terrain-36px.svg'
import FindMatchIcon from './icons/shieldbattery/ic_satellite_dish_black_36px.svg'
import { navigateToLadder } from './ladder/action-creators'
import { LadderRouteComponent } from './ladder/ladder'
import LobbyView from './lobbies/view'
import { regenMapImage, removeMap } from './maps/action-creators'
import { cancelFindMatch } from './matchmaking/action-creators'
import { MatchmakingSearchingOverlay } from './matchmaking/matchmaking-searching-overlay'
import MatchmakingView from './matchmaking/view'
import { IconButton, useButtonHotkey } from './material/button'
import { Tooltip } from './material/tooltip'
import { ConnectedLeftNav } from './navigation/connected-left-nav'
import { ConditionalRoute } from './navigation/custom-routes'
import Index from './navigation/index'
import { replace } from './navigation/routing'
import { addLocalNotification } from './notifications/action-creators'
import { NotificationsButton } from './notifications/activity-bar-entry'
import NotificationPopups from './notifications/notifications-popup'
import { PartyView } from './parties/party-view'
import {
  addAcceptableUseNotificationIfNeeded,
  addPrivacyPolicyNotificationIfNeeded,
  addTermsOfServiceNotificationIfNeeded,
} from './policies/action-creators'
import LoadingIndicator from './progress/dots'
import { useAppDispatch, useAppSelector } from './redux-hooks'
import { openSettingsDialog } from './settings/action-creators'
import { isShieldBatteryHealthy, isStarcraftHealthy } from './starcraft/is-starcraft-healthy'
import { StarcraftStatus } from './starcraft/starcraft-reducer'
import { colorTextSecondary } from './styles/colors'
import { caption } from './styles/typography'
import { FriendsListActivityButton } from './users/friends-list'
import { ProfileRouteComponent } from './users/route'
import { WhisperRouteComponent } from './whispers/route'

const curVersion = __WEBPACK_ENV.VERSION

const ALT_C = { keyCode: keycode('c'), altKey: true }
const ALT_D = { keyCode: keycode('d'), altKey: true }
const ALT_F = { keyCode: keycode('f'), altKey: true }
const ALT_J = { keyCode: keycode('j'), altKey: true }
const ALT_M = { keyCode: keycode('m'), altKey: true }
const ALT_O = { keyCode: keycode('o'), altKey: true }
const ALT_R = { keyCode: keycode('r'), altKey: true }
const ALT_S = { keyCode: keycode('s'), altKey: true }

const Container = styled.div`
  display: flex;
  overflow: hidden;
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
  // TODO(2Pac): Remove `any` once the `LobbyView` is TS-ified
  lobbyRoute = <Route path='/lobbies/:lobby/:rest*' component={LobbyView as any} />
  matchmakingRoute = <Route path='/matchmaking/:rest*' component={MatchmakingView} />
  partyRoute = <Route path='/parties/:partyId/:rest*' component={PartyView} />
}

const AdminPanelComponent = React.lazy(() => import('./admin/panel'))

function LoadableAdminPanel() {
  // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
  // place?)
  return (
    <React.Suspense fallback={<LoadingIndicator />}>
      <AdminPanelComponent />
    </React.Suspense>
  )
}

const MiniActivityButtonsContainer = styled.div`
  width: 100%;
  display: flex;

  flex-wrap: wrap-reverse;
  justify-content: center;
`

const FadedSettingsIcon = styled(SettingsIcon)`
  color: ${colorTextSecondary};
`

/**
 * Tracks if this is the first time this user has logged in on this client. Pretty dumb, if we need
 * more smarts we can add it as a Context var or put it in the store or something.
 */
let firstLoggedIn = true

/**
 * Calls the specified callback only if the StarCraft and ShieldBattery installations are "healthy".
 *
 * The deps argument here won't be linted so you should ensure that it's a complete list.
 */
function useHealthyStarcraftCallback<T extends (...args: any[]) => any>(
  dispatch: DispatchFunction<ReduxAction>,
  starcraft: StarcraftStatus,
  callback: T,
  deps: any[] = [],
) {
  return useCallback(
    (...args: Parameters<T>) => {
      if (!isShieldBatteryHealthy({ starcraft })) {
        dispatch(openDialog({ type: DialogType.ShieldBatteryHealth }))
      } else if (!isStarcraftHealthy({ starcraft })) {
        dispatch(openDialog({ type: DialogType.StarcraftHealth }))
      } else {
        callback(...args)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, starcraft, callback, ...deps],
  )
}

export function MainLayout() {
  const dispatch = useAppDispatch()
  const inGameplayActivity = useAppSelector(s => s.gameplayActivity.inGameplayActivity)
  const isEmailVerified = useAppSelector(s => s.auth.user.emailVerified)
  const isMatchmakingSearching = useAppSelector(s => !!s.matchmaking.searchInfo)
  const lobbyCount = useAppSelector(s => s.serverStatus.lobbyCount)
  const starcraft = useAppSelector(s => s.starcraft)

  const [searchingMatchOverlayOpen, setSearchingMatchOverlayOpen] = useState(false)

  const searchingMatchButtonRef = useRef<HTMLButtonElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  useButtonHotkey({ ref: settingsButtonRef, hotkey: ALT_S })

  useEffect(() => {
    dispatch(openChangelogIfNecessary())

    if (firstLoggedIn) {
      firstLoggedIn = false
      if (!isEmailVerified) {
        dispatch(
          addLocalNotification({
            id: EMAIL_VERIFICATION_ID,
            type: NotificationType.EmailVerification,
          }),
        )
      }

      dispatch(addPrivacyPolicyNotificationIfNeeded())
      dispatch(addTermsOfServiceNotificationIfNeeded())
      dispatch(addAcceptableUseNotificationIfNeeded())
    }

    return () => {
      firstLoggedIn = true
    }
  }, [isEmailVerified, dispatch])

  const onFindMatchClick = useHealthyStarcraftCallback(dispatch, starcraft, () => {
    // TODO(2Pac): Remove `any` once the `openOverlay` is TS-ified
    dispatch(openOverlay('findMatch') as any)
  })

  const onCreateLobbyClick = useHealthyStarcraftCallback(dispatch, starcraft, () => {
    // TODO(2Pac): Remove `any` once the `openOverlay` is TS-ified
    dispatch(openOverlay('createLobby') as any)
  })

  const onJoinLobbyClick = useHealthyStarcraftCallback(dispatch, starcraft, () => {
    // TODO(2Pac): Remove `any` once the `openOverlay` is TS-ified
    dispatch(openOverlay('joinLobby') as any)
  })

  const onMapDetails = useCallback(
    (map: MapInfoJson) => {
      dispatch(openDialog({ type: DialogType.MapDetails, initData: { mapId: map.id } }))
    },
    [dispatch],
  )

  const onRemoveMap = useCallback(
    (map: MapInfoJson) => {
      dispatch(removeMap(map))
    },
    [dispatch],
  )

  const onRegenMapImage = useCallback(
    (map: MapInfoJson) => {
      dispatch(regenMapImage(map))
    },
    [dispatch],
  )

  const onMapUpload = useCallback(
    (map: MapInfoJson) => {
      // TODO(2Pac): Remove `any` once the `openOverlay` is TS-ified
      dispatch(
        openOverlay('browseServerMaps', {
          uploadedMap: map,
          title: 'Maps',
          onMapUpload,
          onMapSelect: onMapDetails,
          onMapDetails,
          onRemoveMap,
          onRegenMapImage,
        }) as any,
      )
    },
    [dispatch, onMapDetails, onRegenMapImage, onRemoveMap],
  )

  // TODO(tec27): Figure out why the hell this requires a valid starcraft installation and then fix
  // that and remove this requirement
  const onMapsClick = useHealthyStarcraftCallback(
    dispatch,
    starcraft,
    () => {
      // TODO(2Pac): Remove `any` once the `openOverlay` is TS-ified
      dispatch(
        openOverlay('browseServerMaps', {
          title: 'Maps',
          onMapUpload,
          onMapSelect: onMapDetails,
          onMapDetails,
          onRemoveMap,
          onRegenMapImage,
        }) as any,
      )
    },
    [onMapDetails, onMapUpload, onRegenMapImage, onRemoveMap],
  )

  const onReplaysClick = useCallback(() => {
    if (!isShieldBatteryHealthy({ starcraft })) {
      dispatch(openDialog({ type: DialogType.ShieldBatteryHealth }))
    } else if (!isStarcraftHealthy({ starcraft })) {
      dispatch(openDialog({ type: DialogType.StarcraftHealth }))
    } else {
      // TODO(2Pac): Remove `any` once the `openOverlay` is TS-ified
      dispatch(openOverlay('browseLocalReplays') as any)
    }
  }, [dispatch, starcraft])

  const findMatchButton = !isMatchmakingSearching ? (
    <ActivityButton
      key='find-match'
      icon={<FindMatchIcon />}
      label='Find match'
      onClick={onFindMatchClick}
      disabled={inGameplayActivity}
      hotkey={ALT_F}
    />
  ) : (
    <ActivityButton
      key='searching-match'
      ref={searchingMatchButtonRef}
      icon={<FindMatchIcon />}
      glowing={true}
      label='Finding…'
      onClick={() => setSearchingMatchOverlayOpen(true)}
      hotkey={ALT_F}
    />
  )
  const activityButtons = IS_ELECTRON
    ? [
        findMatchButton,
        <ActivityButton
          key='create-game'
          icon={<CreateGameIcon />}
          label='Create'
          onClick={onCreateLobbyClick}
          disabled={inGameplayActivity}
          hotkey={ALT_C}
        />,
        <ActivityButton
          key='join-game'
          icon={<JoinGameIcon />}
          label='Join'
          onClick={onJoinLobbyClick}
          hotkey={ALT_J}
          count={lobbyCount > 0 ? lobbyCount : undefined}
        />,
        <ActivityButton
          key='maps'
          icon={<StyledMapsIcon />}
          label='Maps'
          onClick={onMapsClick}
          hotkey={ALT_M}
        />,
        <ActivityButton
          key='replays'
          icon={<ReplaysIcon />}
          label='Replays'
          onClick={onReplaysClick}
          hotkey={ALT_R}
        />,
        <ActivityButton
          key='ladder'
          icon={<LadderIcon />}
          label='Ladder'
          onClick={() => navigateToLadder()}
          hotkey={ALT_D}
        />,
        <ActivitySpacer key='spacer' />,
      ]
    : [
        <ActivityButton
          key='download'
          icon={<DownloadIcon />}
          label='Download'
          onClick={() => dispatch(openDialog({ type: DialogType.Download }))}
          hotkey={ALT_O}
        />,
        <ActivityButton
          key='ladder'
          icon={<LadderIcon />}
          label='Ladder'
          onClick={() => navigateToLadder()}
          hotkey={ALT_D}
        />,
        <ActivitySpacer key='spacer' />,
      ]

  const renderSearchingMatchOverlay = () => {
    if (!IS_ELECTRON && !isMatchmakingSearching) {
      return null
    }

    return (
      <MatchmakingSearchingOverlay
        open={searchingMatchOverlayOpen}
        anchor={searchingMatchButtonRef.current ?? undefined}
        onCancelSearch={() => {
          dispatch(cancelFindMatch())
          setSearchingMatchOverlayOpen(false)
        }}
        onDismiss={() => setSearchingMatchOverlayOpen(false)}
      />
    )
  }

  return (
    <Container>
      <ConnectedLeftNav />
      <Content>
        <Switch>
          <ConditionalRoute
            path='/admin/:rest*'
            filters={[IsAdminFilter]}
            component={LoadableAdminPanel}
          />
          <Route path='/chat/:rest*' component={ChannelRouteComponent} />
          <Route path='/ladder/:rest*' component={LadderRouteComponent} />
          <Route path='/games/:rest*' component={GamesRouteComponent} />
          {lobbyRoute}
          {matchmakingRoute}
          {partyRoute}
          <Route path='/users/:rest*' component={ProfileRouteComponent} />
          {/* TODO(2Pac): Remove `any` once the `Whisper` is TS-ified */}
          <Route path='/whispers/:rest*' component={WhisperRouteComponent} />
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
          <Tooltip text='Settings (Alt + S)' position='left'>
            <IconButton
              key='settings'
              ref={settingsButtonRef}
              icon={<FadedSettingsIcon />}
              onClick={() => dispatch(openSettingsDialog())}
            />
          </Tooltip>
          <FriendsListActivityButton />
        </MiniActivityButtonsContainer>

        <VersionText key='version'>v{curVersion}</VersionText>
      </ActivityBar>
      {renderSearchingMatchOverlay()}
      <ActivityOverlay />
      <NotificationPopups />
    </Container>
  )
}
