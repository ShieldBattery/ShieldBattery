import React from 'react'
import { hot } from 'react-hot-loader/root'
import { Link, Route, Switch } from 'wouter'
import { PermissionsRecord } from '../auth/auth-records'
import { ConditionalRoute } from '../navigation/custom-routes'
import { useAppSelector } from '../redux-hooks'
import {
  CanManageMapPoolsFilter,
  CanManageMatchmakingTimesFilter,
  CanManageRallyPointFilter,
  CanSeeDebugFilter,
} from './admin-route-filters'
import { DebugLogs } from './debug-logs'
import AdminMapPools from './map-pools'
import AdminMatchmakingTimes from './matchmaking-times'
import { AdminRallyPoint } from './rally-point'

const AdminMapManager = IS_ELECTRON ? require('./map-manager').default : null

interface AdminDashboardProps {
  permissions: PermissionsRecord
}

function AdminDashboard(props: AdminDashboardProps) {
  const perms = props.permissions

  const debugLinks = perms.debug ? (
    <>
      <li>
        <Link href='/admin/debug-logs'>Debug logs</Link>
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
      {debugLinks}
      {mapsLink}
      {mapPoolsLink}
      {matchmakingTimesLink}
      {rallyPointLink}
    </ul>
  )
}

function AdminPanel() {
  const perms = useAppSelector(s => s.auth.permissions)

  return (
    <Switch>
      {AdminMapManager ? <Route path='/admin/map-manager' component={AdminMapManager} /> : <></>}
      <ConditionalRoute
        path='/admin/map-pools'
        filters={[CanManageMapPoolsFilter]}
        component={AdminMapPools}
      />
      <ConditionalRoute
        path='/admin/matchmaking-times'
        filters={[CanManageMatchmakingTimesFilter]}
        component={AdminMatchmakingTimes}
      />
      <ConditionalRoute
        path='/admin/debug-logs/:rest*'
        filters={[CanSeeDebugFilter]}
        component={DebugLogs}
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

// NOTE(tec27): @loadable/component seems to screw with react-hot-loader in weird ways, so we make
// this root it's own hot context to keep things working inside here
export default hot(AdminPanel)
