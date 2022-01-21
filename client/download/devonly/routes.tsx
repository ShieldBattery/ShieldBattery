import React from 'react'
import { Link, Route, Switch } from 'wouter'
import { UpdateDialogTest } from './update-dialog-test'

export function DevDownload() {
  return (
    <Switch>
      <Route path='/dev/download/update' component={UpdateDialogTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/download/update'>Update dialog</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
