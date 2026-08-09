import { Link, Route, Switch } from 'wouter'
import { DownloadDialogTest } from './download-dialog-test'
import { UpdateDialogTest } from './update-dialog-test'

export function DevDownload() {
  return (
    <Switch>
      <Route path='/dev/download/update' component={UpdateDialogTest} />
      <Route path='/dev/download/download-dialog' component={DownloadDialogTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/download/update'>Update dialog</Link>
          </li>
          <li>
            <Link href='/dev/download/download-dialog'>Download dialog</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
