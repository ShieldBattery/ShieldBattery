import React from 'react'
import { Link, Route, Switch } from 'wouter'
import { PermissionsRecord } from '../auth/auth-records'
import { ConditionalRoute } from '../navigation/custom-routes'
import { useAppSelector } from '../redux-hooks'
import {
  CanManageChatChannels,
  CanManageMapPoolsFilter,
  CanManageMatchmakingSeasonsFilter,
  CanManageMatchmakingTimesFilter,
  CanManageRallyPointFilter,
} from './admin-route-filters'
import { AdminChatChannels } from './chat-channels'
import AdminMapPools from './map-pools'
import { AdminMatchmakingSeasons } from './matchmaking-seasons'
import AdminMatchmakingTimes from './matchmaking-times'
import { AdminRallyPoint } from './rally-point'

const AdminMapManager = IS_ELECTRON ? require('./map-manager').default : null

interface AdminDashboardProps {
  permissions: PermissionsRecord
}

function AdminDashboard(props: AdminDashboardProps) {
  const perms = props.permissions

  const chatChannelsLink = perms.moderateChatChannels ? (
    <>
      <li>
        <Link href='/admin/chat-channels'>Chat channels</Link>
      </li>
    </>
  ) : null
  const mapsLink =
    (perms.manageMaps || perms.massDeleteMaps) && IS_ELECTRON ? (
      <li>
        <Link href='/admin/map-manager'>Manage maps</Link>
      </li>
    ) : null
  const mapPoolsLink = perms.manageMapPools ? (
    <li>
      <Link href='/admin/map-pools'>Manage matchmaking map pools</Link>
    </li>
  ) : null
  const matchmakingSeasonsLink = perms.manageMatchmakingSeasons ? (
    <li>
      <Link href='/admin/matchmaking-seasons'>Manage matchmaking seasons</Link>
    </li>
  ) : null
  const matchmakingTimesLink = perms.manageMatchmakingTimes ? (
    <li>
      <Link href='/admin/matchmaking-times'>Manage matchmaking times</Link>
    </li>
  ) : null
  const rallyPointLink = perms.manageRallyPointServers ? (
    <li>
      <Link href='/admin/rally-point'>Manage rally-point servers</Link>
    </li>
  ) : null

  return (
    <ul>
      {chatChannelsLink}
      {mapsLink}
      {mapPoolsLink}
      {matchmakingSeasonsLink}
      {matchmakingTimesLink}
      {rallyPointLink}
    </ul>
  )
}

export default function AdminPanel() {
  const perms = useAppSelector(s => s.auth.permissions)

  return (
    <Switch>
      <ConditionalRoute
        path='/admin/chat-channels'
        filters={[CanManageChatChannels]}
        component={AdminChatChannels}
      />
      {AdminMapManager ? <Route path='/admin/map-manager' component={AdminMapManager} /> : <></>}
      <ConditionalRoute
        path='/admin/map-pools'
        filters={[CanManageMapPoolsFilter]}
        component={AdminMapPools}
      />
      <ConditionalRoute
        path='/admin/matchmaking-seasons'
        filters={[CanManageMatchmakingSeasonsFilter]}
        component={AdminMatchmakingSeasons}
      />
      <ConditionalRoute
        path='/admin/matchmaking-times'
        filters={[CanManageMatchmakingTimesFilter]}
        component={AdminMatchmakingTimes}
      />
      <ConditionalRoute
        path='/admin/rally-point/:rest*'
        filters={[CanManageRallyPointFilter]}
        component={AdminRallyPoint}
      />
      <Route path='/admin'>
        <AdminDashboard permissions={perms} />
      </Route>
    </Switch>
  )
}
