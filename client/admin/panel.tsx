import * as React from 'react'
import { Suspense } from 'react'
import { Link, Redirect, Route, Switch } from 'wouter'
import { useSelfPermissions } from '../auth/auth-utils'
import { LoadingDotsArea } from '../progress/dots'

const LoadableBugReports = React.lazy(async () => ({
  default: (await import('../bugs/admin-bug-reports')).AdminBugReports,
}))
const LoadableManageNews = React.lazy(async () => ({
  default: (await import('./admin-news')).AdminNews,
}))
const LoadableGameReports = React.lazy(async () => ({
  default: (await import('../games/admin-game-reports')).AdminGameReports,
}))
const LoadableMapManager = IS_ELECTRON
  ? React.lazy(async () => ({
      default: (await import('./map-manager')).AdminMapManager,
    }))
  : () => null
const LoadableMapPools = React.lazy(async () => ({
  default: (await import('../matchmaking/admin-map-pools')).AdminMatchmakingMapPools,
}))
const LoadableMatchmakingConfig = React.lazy(async () => ({
  default: (await import('./matchmaking-config')).AdminMatchmakingConfig,
}))
const LoadableMatchmakingSeasons = React.lazy(async () => ({
  default: (await import('./matchmaking-seasons')).AdminMatchmakingSeasons,
}))
const LoadableMatchmakingTimes = React.lazy(async () => ({
  default: (await import('../matchmaking/admin-matchmaking-times')).AdminMatchmakingTimes,
}))
const LoadableRestrictedNames = React.lazy(async () => ({
  default: (await import('./restricted-names')).RestrictedNames,
}))
const LoadableSignupCodes = React.lazy(async () => ({
  default: (await import('./signup-codes')).SignupCodes,
}))
const LoadableUrgentMessage = React.lazy(async () => ({
  default: (await import('./urgent-message')).AdminUrgentMessage,
}))

export default function AdminPanel() {
  const perms = useSelfPermissions()

  const routes: Array<
    [
      path: string,
      hasPermissions: boolean | undefined,
      Component: React.ComponentType,
      name: string,
    ]
  > = [
    ['/admin/bug-reports', perms?.manageBugReports, LoadableBugReports, 'Manage bug reports'],
    ['/admin/game-reports', perms?.manageGameReports, LoadableGameReports, 'Manage game reports'],
    [
      '/admin/map-manager',
      perms?.manageMaps || perms?.massDeleteMaps,
      LoadableMapManager,
      'Manage maps',
    ],
    ['/admin/map-pools', perms?.manageMapPools, LoadableMapPools, 'Manage matchmaking map pools'],
    ['/admin/news', perms?.manageNews, LoadableManageNews, 'Manage news'],
    [
      '/admin/matchmaking-config',
      perms?.manageMatchmaking,
      LoadableMatchmakingConfig,
      'Manage matchmaking config',
    ],
    [
      '/admin/matchmaking-seasons',
      perms?.manageMatchmakingSeasons,
      LoadableMatchmakingSeasons,
      'Manage matchmaking seasons',
    ],
    [
      '/admin/matchmaking-times',
      perms?.manageMatchmakingTimes,
      LoadableMatchmakingTimes,
      'Manage matchmaking times',
    ],
    [
      '/admin/restricted-names',
      perms?.manageRestrictedNames,
      LoadableRestrictedNames,
      'Manage restricted names',
    ],
    ['/admin/signup-codes', perms?.manageSignupCodes, LoadableSignupCodes, 'Manage signup codes'],
    ['/admin/urgent-message', perms?.manageNews, LoadableUrgentMessage, 'Set urgent message'],
  ]

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        {routes.map(([path, hasPermissions, Component]) => (
          <Route path={path + '/*?'} key={path}>
            {hasPermissions ? <Component /> : <Redirect to='/' />}
          </Route>
        ))}

        <Route path='/admin/*?'>
          <ul>
            {routes.map(([path, hasPermissions, _, name]) => {
              return hasPermissions ? (
                <li key={path}>
                  <Link href={path}>{name}</Link>
                </li>
              ) : null
            })}
          </ul>
        </Route>
      </Switch>
    </Suspense>
  )
}
