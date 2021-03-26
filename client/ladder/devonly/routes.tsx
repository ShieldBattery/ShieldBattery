import React from 'react'
import { Link, Route, Switch } from 'wouter'
import { TableTest } from './table-test'

export function DevLadder() {
  return (
    <Switch>
      <Route path='/dev/ladder/table' component={TableTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/ladder/table'>Table</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
