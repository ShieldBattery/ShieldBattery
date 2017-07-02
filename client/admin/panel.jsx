import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import ContentLayout from '../content/content-layout.jsx'

@connect(state => ({ auth: state.auth }))
export default class Panel extends React.Component {
  render() {
    const perms = this.props.auth.permissions

    const usersLink =
      perms.editPermissions || perms.banUsers
        ? <li>
            <Link to="/admin/users">View user's profile</Link>
          </li>
        : null
    const uploadLink =
      perms.manageMaps && IS_ELECTRON
        ? <li>
            <Link to="/admin/map-upload">Mass map upload</Link>
          </li>
        : null
    const managePatchesLink =
      perms.manageStarcraftPatches && IS_ELECTRON
        ? <li>
            <Link to="/admin/patch-upload">Upload StarCraft patch</Link>
          </li>
        : null
    const invitesLink = perms.acceptInvites
      ? <li>
          <Link to="/admin/invites">View beta invites</Link>
        </li>
      : null
    const mapPoolsLink =
      perms.manageMapPools && IS_ELECTRON
        ? <li>
            <Link to="/admin/map-pools/1v1">Manage matchmaking map pools</Link>
          </li>
        : null

    return (
      <ContentLayout title={'Admin panel'}>
        <ul>
          {usersLink}
          {uploadLink}
          {managePatchesLink}
          {mapPoolsLink}
          {invitesLink}
        </ul>
      </ContentLayout>
    )
  }
}
