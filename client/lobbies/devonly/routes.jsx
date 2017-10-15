import React from 'react'
import { Route, Switch } from 'react-router-dom'
import Lobby from './lobby-test.jsx'
import Loading from './loading-test.jsx'

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route path={baseUrl + '/lobby'} component={Lobby} />
      <Route path={baseUrl + '/loading'} component={Loading} />
    </Switch>
  )
}
