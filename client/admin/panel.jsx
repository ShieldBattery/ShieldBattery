import React from 'react'
import { connect } from 'react-redux'
import { Link, Route, Switch } from 'wouter'
import { hot } from 'react-hot-loader/root'

import AdminMapPools from './map-pools'
import AdminMatchmakingTimes from './matchmaking-times'
import { ConditionalRoute } from '../navigation/custom-routes'
import { UserFind } from './user-profile'
import {
  CanManageMapPoolsFilter,
  CanManageMatchmakingTimesFilter,
  CanViewUserProfileFilter,
} from './admin-route-filters'

const AdminMapManager = IS_ELECTRON ? require('./map-manager').default : null

class AdminDashboard extends React.Component {
  render() {
    const perms = this.props.permissions

    const usersLink =
      perms.editPermissions || perms.banUsers ? (
        <li>
          <Link href='/admin/users'>View user's profile</Link>
        </li>
      ) : null
    const mapsLink =
      (perms.manageMaps || perms.massDeleteMaps) && IS_ELECTRON ? (
        <li>
          <Link href='/admin/map-manager'>Manage maps</Link>
        </li>
      ) : null
    const mapPoolsLink = perms.manageMapPools ? (
      <li>
        <Link href='/admin/map-pools'>Manage matchmaking map pools</Link>
      </li>
    ) : null
    const matchmakingTimesLink = perms.manageMatchmakingTimes ? (
      <li>
        <Link href='/admin/matchmaking-times'>Manage matchmaking times</Link>
      </li>
    ) : null

    return (
      <ul>
        {usersLink}
        {mapsLink}
        {mapPoolsLink}
        {matchmakingTimesLink}
      </ul>
    )
  }
}

@connect(state => ({ auth: state.auth }))
class Panel extends React.Component {
  render() {
    const perms = this.props.auth.permissions

    return (
      <Switch>
        <ConditionalRoute
          path='/admin/users/:username?'
          filters={[CanViewUserProfileFilter]}
          component={UserFind}
        />
        {AdminMapManager ? <Route path='/admin/map-manager' component={AdminMapManager} /> : <></>}
        <ConditionalRoute
          path='/admin/map-pools'
          filters={[CanManageMapPoolsFilter]}
          component={AdminMapPools}
        />
        <ConditionalRoute
          path='/admin/matchmaking-times'
          filters={[CanManageMatchmakingTimesFilter]}
          component={AdminMatchmakingTimes}
        />
        <Route path='/admin'>
          <AdminDashboard permissions={perms} />
        </Route>
      </Switch>
    )
  }
}

// NOTE(tec27): @loadable/component seems to screw with react-hot-loader in weird ways, so we make
// this root it's own hot context to keep things working inside here
export default hot(Panel)
