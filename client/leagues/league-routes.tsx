import React, { Suspense } from 'react'
import { Route, Switch } from 'wouter'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { LoadingDotsArea } from '../progress/dots'
import { LeagueDetailsPage } from './league-details'
import { LeagueList } from './league-list'

const LoadableLeagueAdmin = React.lazy(async () => ({
  default: (await import('./league-admin')).LeagueAdmin,
}))

export function LeagueRoot(props: { params: any }) {
  const isAdmin = useHasAnyPermission('manageLeagues')

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        {isAdmin ? <Route path='/leagues/admin/*?' component={LoadableLeagueAdmin} /> : <></>}
        <Route path='/leagues/:id/*?' component={LeagueDetailsPage} />
        <Route component={LeagueList} />
      </Switch>
    </Suspense>
  )
}
