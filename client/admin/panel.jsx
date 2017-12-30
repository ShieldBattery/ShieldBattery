import React from 'react'
import { connect } from 'react-redux'
import { Link, Route, Switch } from 'react-router-dom'

import AdminBetaInvites from './invites.jsx'
import ContentLayout from '../content/content-layout.jsx'
import { ConditionalRoute } from '../navigation/custom-routes.jsx'
import { UserFind } from './user-profile.jsx'
import {
  CanAcceptBetaInvitesFilter,
  CanManageStarcraftPatchesFilter,
  CanViewUserProfileFilter,
} from './admin-route-filters.jsx'

const AdminMapUpload = IS_ELECTRON ? require('./map-upload.jsx').default : null
const AdminPatchUpload = IS_ELECTRON ? require('./patch-upload.jsx').default : null

class AdminDashboard extends React.Component {
  render() {
    const perms = this.props.permissions

    const usersLink =
      perms.editPermissions || perms.banUsers ? (
        <li>
          <Link to="/admin/users">View user's profile</Link>
        </li>
      ) : null
    const uploadLink =
      perms.manageMaps && IS_ELECTRON ? (
        <li>
          <Link to="/admin/map-upload">Mass map upload</Link>
        </li>
      ) : null
    const managePatchesLink =
      perms.manageStarcraftPatches && IS_ELECTRON ? (
        <li>
          <Link to="/admin/patch-upload">Upload StarCraft patch</Link>
        </li>
      ) : null
    const invitesLink = perms.acceptInvites ? (
      <li>
        <Link to="/admin/invites">View beta invites</Link>
      </li>
    ) : null

    return (
      <ContentLayout title={'Admin panel'}>
        <ul>
          {usersLink}
          {uploadLink}
          {managePatchesLink}
          {invitesLink}
        </ul>
      </ContentLayout>
    )
  }
}

@connect(state => ({ auth: state.auth }))
export default class Panel extends React.Component {
  render() {
    const perms = this.props.auth.permissions

    return (
      <Switch>
        <Route path="/admin" exact={true} render={() => <AdminDashboard permissions={perms} />} />
        <ConditionalRoute
          path="/admin/users"
          filters={[CanViewUserProfileFilter]}
          component={UserFind}
        />
        <ConditionalRoute
          path="/admin/invites"
          filters={[CanAcceptBetaInvitesFilter]}
          component={AdminBetaInvites}
        />
        {AdminPatchUpload ? (
          <ConditionalRoute
            path="/admin/patch-upload"
            filters={[CanManageStarcraftPatchesFilter]}
            component={AdminPatchUpload}
          />
        ) : null}
        {AdminMapUpload ? <Route path="/admin/map-upload" component={AdminMapUpload} /> : null}
      </Switch>
    )
  }
}
