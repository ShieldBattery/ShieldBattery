import React, { Suspense } from 'react'
import { Link, Redirect, Route, Switch } from 'wouter'
import { SbPermissions } from '../../common/users/permissions'
import { useSelfPermissions } from '../auth/auth-utils'
import { LoadingDotsArea } from '../progress/dots'

const LoadableBugReports = React.lazy(async () => ({
  default: (await import('../bugs/admin-bug-reports')).AdminBugReports,
}))
const LoadableMapManager = IS_ELECTRON
  ? React.lazy(async () => ({
      default: (await import('./map-manager')).AdminMapManager,
    }))
  : () => null
const LoadableMapPools = React.lazy(() => import('./map-pools'))
const LoadableMatchmakingSeasons = React.lazy(async () => ({
  default: (await import('./matchmaking-seasons')).AdminMatchmakingSeasons,
}))
const LoadableMatchmakingTimes = React.lazy(() => import('./matchmaking-times'))
const LoadableRallyPoint = React.lazy(async () => ({
  default: (await import('./rally-point')).AdminRallyPoint,
}))
const LoadableRestrictedNames = React.lazy(async () => ({
  default: (await import('./restricted-names')).RestrictedNames,
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
  const restrictedNamesLink = perms?.manageRestrictedNames ? (
    <li>
      <Link href='/admin/restricted-names'>Manage restricted names</Link>
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
      {restrictedNamesLink}
    </ul>
  )
}

export default function AdminPanel() {
  const perms = useSelfPermissions()

  return (
    <Suspense fallback={<LoadingDotsArea />}>
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
        <Route path='/admin/restricted-names/*?'>
          {perms?.manageRestrictedNames ? <LoadableRestrictedNames /> : <Redirect to='/' />}
        </Route>

        <Route path='/admin/*?'>
          <AdminDashboard permissions={perms} />
        </Route>
      </Switch>
    </Suspense>
  )
}
