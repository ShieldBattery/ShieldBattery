import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'

import { getInvites, acceptUser } from './action-creators'

@connect(state => ({ invites: state.invites }))
export default class Invites extends React.Component {
  _retrieveData() {
    const { location: { query: { accepted } } } = this.props
    let type
    if (accepted === 'true') {
      type = 'accepted'
    } else if (accepted === 'false') {
      type = 'unaccepted'
    }

    this.props.dispatch(getInvites(type))
  }

  componentDidMount() {
    this._retrieveData()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.location.query.accepted !== this.props.location.query.accepted) {
      this._retrieveData()
    }
  }

  renderAcceptLink(invitee) {
    return (<Link to='/admin/invites'
        onClick={() => this.onAcceptUserClicked(invitee.email)}>Accept</Link>)
  }

  renderInviteeRow(invitee) {
    return (
      <tr key={invitee.email}>
        <td>{invitee.email}</td>
        <td>{invitee.teamliquidName}</td>
        <td>{invitee.os}</td>
        <td>{invitee.browser}</td>
        <td>{invitee.graphics}</td>
        <td>{invitee.canHost ? <span>Yes</span> : <span>No</span>}</td>
        <td>
          {invitee.isAccepted ? <span>Yes</span> : <span>{this.renderAcceptLink(invitee)}</span>}
        </td>
      </tr>
    )
  }

  renderInvites() {
    const { signups, byEmail } = this.props.invites
    if (signups.size === 0) return null

    return (
      <table className={styles.invitesTable}>
        <thead>
          <tr>
            <th>Email</th>
            <th>TL Name</th>
            <th>OS</th>
            <th>Browser</th>
            <th>Graphics</th>
            <th>Can Host</th>
            <th>Accepted</th>
          </tr>
        </thead>
        <tbody>
          { signups.map(e => this.renderInviteeRow(byEmail.get(e))) }
        </tbody>
      </table>
    )
  }

  renderError() {
    const { lastError } = this.props.invites
    if (!lastError) return null

    return <div className={styles.invitesError}>{lastError.message}</div>
  }

  render() {
    return (
      <ContentLayout title={'Invites'}>
        <div className={styles.invites}>
          { this.renderError() }
          <div className={styles.filterInvites}>
            <Link to='/admin/invites'>All</Link>
            <Link to='/admin/invites?accepted=true'>Accepted</Link>
            <Link to='/admin/invites?accepted=false'>Unaccepted</Link>
          </div>
          { this.renderInvites() }
        </div>
      </ContentLayout>
    )
  }

  onAcceptUserClicked(email) {
    this.props.dispatch(acceptUser(email))
  }
}
