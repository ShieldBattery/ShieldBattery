import React from 'react'
import { Route } from 'react-router'
import Lobby from './lobby-test.jsx'
import Loading from './loading-test.jsx'

export default (
  <Route path="/devlobbies/">
    <Route path="lobby" component={Lobby} />
    <Route path="loading" component={Loading} />
  </Route>
)
