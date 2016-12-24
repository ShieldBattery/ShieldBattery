import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import ContentLayout from '../content/content-layout.jsx'

@connect(state => ({ auth: state.auth }))
export default class Panel extends React.Component {
  render() {
    const perms = this.props.auth.permissions

    const usersLink = (perms.editPermissions || perms.banUsers) ?
        <li><Link to='/admin/users'>View user's profile</Link></li> : null
    const invitesLink = perms.acceptInvites ?
        <li><Link to='/admin/invites'>View beta invites</Link></li> : null

    return (
      <ContentLayout title={'Admin panel'}>
        <ul>
          {usersLink}
          {invitesLink}
        </ul>
      </ContentLayout>
    )
  }
}
