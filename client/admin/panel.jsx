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
    const uploadLink = process.webpackEnv.SB_ENV === 'electron' ?
        <li><Link to='/admin/map-upload'>Mass map upload</Link></li> : null
    const invitesLink = perms.acceptInvites ?
        <li><Link to='/admin/invites'>View beta invites</Link></li> : null

    return (
      <ContentLayout title={'Admin panel'}>
        <ul>
          {usersLink}
          {uploadLink}
          {invitesLink}
        </ul>
      </ContentLayout>
    )
  }
}
