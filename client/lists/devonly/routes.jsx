import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import DevCarousels from './carousel-test.jsx'

class DevListsDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
        <li>
          <Link to={baseUrl + '/carousel'}>Carousel</Link>
        </li>
      </ul>
    )
  }
}

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route path={baseUrl} exact={true} render={() => <DevListsDashboard baseUrl={baseUrl} />} />
      <Route path={baseUrl + '/Carousel'} component={DevCarousels} />
    </Switch>
  )
}
