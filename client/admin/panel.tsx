import React from 'react'
import { Link, Redirect, Route, Switch } from 'wouter'
import { SbPermissions } from '../../common/users/permissions.js'
import { useSelfPermissions } from '../auth/auth-utils.js'

const LoadableBugReports = React.lazy(async () => ({
  default: (await import('../bugs/admin-bug-reports.js')).AdminBugReports,
}))
const LoadableMapManager = IS_ELECTRON ? React.lazy(() => import('./map-manager.js')) : () => null
const LoadableMapPools = React.lazy(() => import('./map-pools.js'))
const LoadableMatchmakingSeasons = React.lazy(async () => ({
  default: (await import('./matchmaking-seasons.js')).AdminMatchmakingSeasons,
}))
const LoadableMatchmakingTimes = React.lazy(() => import('./matchmaking-times.js'))
const LoadableRallyPoint = React.lazy(async () => ({
  default: (await import('./rally-point.js')).AdminRallyPoint,
}))

interface AdminDashboardProps {
  permissions?: SbPermissions
}

function AdminDashboard(props: AdminDashboardProps) {
  const perms = props.permissions

  const bugReportsLink = perms?.manageBugReports ? (
    <li>
      <Link href='/admin/bug-reports'>Manage bug reports</Link>
    </li>
  ) : null
  const mapsLink =
    (perms?.manageMaps || perms?.massDeleteMaps) && IS_ELECTRON ? (
      <li>
        <Link href='/admin/map-manager'>Manage maps</Link>
      </li>
    ) : null
  const mapPoolsLink = perms?.manageMapPools ? (
    <li>
      <Link href='/admin/map-pools'>Manage matchmaking map pools</Link>
    </li>
  ) : null
  const matchmakingSeasonsLink = perms?.manageMatchmakingSeasons ? (
    <li>
      <Link href='/admin/matchmaking-seasons'>Manage matchmaking seasons</Link>
    </li>
  ) : null
  const matchmakingTimesLink = perms?.manageMatchmakingTimes ? (
    <li>
      <Link href='/admin/matchmaking-times'>Manage matchmaking times</Link>
    </li>
  ) : null
  const rallyPointLink = perms?.manageRallyPointServers ? (
    <li>
      <Link href='/admin/rally-point'>Manage rally-point servers</Link>
    </li>
  ) : null

  return (
    <ul>
      {bugReportsLink}
      {mapsLink}
      {mapPoolsLink}
      {matchmakingSeasonsLink}
      {matchmakingTimesLink}
      {rallyPointLink}
    </ul>
  )
}

export default function AdminPanel() {
  const perms = useSelfPermissions()

  return (
    <Switch>
      <Route path='/admin/bug-reports/*?'>
        {perms?.manageBugReports ? <LoadableBugReports /> : <Redirect to='/' />}
      </Route>
      <Route path='/admin/map-manager/*?'>
        {(perms?.manageMaps || perms?.massDeleteMaps) && IS_ELECTRON ? (
          <LoadableMapManager />
        ) : (
          <Redirect to='/' />
        )}
      </Route>
      <Route path='/admin/map-pools/*?'>
        {perms?.manageMapPools ? <LoadableMapPools /> : <Redirect to='/' />}
      </Route>
      <Route path='/admin/matchmaking-seasons/*?'>
        {perms?.manageMatchmakingSeasons ? <LoadableMatchmakingSeasons /> : <Redirect to='/' />}
      </Route>
      <Route path='/admin/matchmaking-times/*?'>
        {perms?.manageMatchmakingTimes ? <LoadableMatchmakingTimes /> : <Redirect to='/' />}
      </Route>
      <Route path='/admin/rally-point/*?'>
        {perms?.manageRallyPointServers ? <LoadableRallyPoint /> : <Redirect to='/' />}
      </Route>

      <Route path='/admin/*?'>
        <AdminDashboard permissions={perms} />
      </Route>
    </Switch>
  )
}
