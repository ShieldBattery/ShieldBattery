import React from 'react'
import { Link, Route, Switch } from 'wouter'
import DevCarousels from './carousel-test'

const BASE_URL = '/dev/lists'

class DevListsDashboard extends React.Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/carousel`}>Carousel</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/carousel`} component={DevCarousels} />
      <Route>
        <DevListsDashboard />
      </Route>
    </Switch>
  )
}
