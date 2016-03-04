import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import ContentLayout from '../content/content-layout.jsx'

@connect(state => ({ auth: state.auth }))
export default class Panel extends React.Component {
  render() {
    const perms = this.props.auth.permissions

    const permissionsLink = perms.editPermissions ?
        <li><Link to='/admin/permissions'>Change user permissions</Link></li> : null
    const invitesLink = perms.acceptInvites ?
        <li><Link to='/admin/invites'>View beta invites</Link></li> : null

    return (
      <ContentLayout title={'Admin panel'}>
        <ul>
          {permissionsLink}
          {invitesLink}
        </ul>
      </ContentLayout>
    )
  }
}
