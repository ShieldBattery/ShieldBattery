import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import ContentLayout from '../../content/content-layout.jsx'
import Lobby from './lobby-test.jsx'
import Loading from './loading-test.jsx'

class DevLobbiesDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ContentLayout title={'Lobbies-related components'}>
        <ul>
          <li>
            <Link to={baseUrl + '/lobby'}>Lobby component</Link>
          </li>
          <li>
            <Link to={baseUrl + '/loading'}>Loading component</Link>
          </li>
        </ul>
      </ContentLayout>
    )
  }
}

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route path={baseUrl} exact={true} render={() => <DevLobbiesDashboard baseUrl={baseUrl} />} />
      <Route path={baseUrl + '/lobby'} component={Lobby} />
      <Route path={baseUrl + '/loading'} component={Loading} />
    </Switch>
  )
}
