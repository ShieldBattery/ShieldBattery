import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'

import { getInvites, acceptUser } from './action-creators'

@connect(state => ({ invites: state.invites }))
export default class Invites extends React.Component {
  constructor(props) {
    super(props)

    this._allHandler = ::this.onAllClicked
    this._acceptedHandler = ::this.onAcceptedClicked
    this._unacceptedHandler = ::this.onUnacceptedClicked
  }

  getInviteeRow(invitee) {
    const acceptLink = <Link to='/admin/invites'
        onClick={() => this.onAcceptUserClicked(invitee.email)}>Accept</Link>

    return (
      <tr key={invitee.email}>
        <td>{invitee.email}</td>
        <td>{invitee.teamliquidName}</td>
        <td>{invitee.os}</td>
        <td>{invitee.browser}</td>
        <td>{invitee.graphics}</td>
        <td>{invitee.canHost ? <span>Yes</span> : <span>No</span>}</td>
        <td>{invitee.isAccepted ? <span>Yes</span> : <span>{acceptLink}</span>}</td>
      </tr>
    )
  }

  renderInvites() {
    const { signups } = this.props.invites
    if (signups.size === 0) return null

    const emails = signups.keySeq().toArray()
    const inviteeRows = []
    for (let i = 0; i < signups.size; i++) {
      inviteeRows.push(this.getInviteeRow(signups.get(emails[i])))
    }

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
          {inviteeRows}
        </tbody>
      </table>
    )
  }

  render() {
    return (
      <ContentLayout title={'Invites'}>
        <div className={styles.invites}>
          <div className={styles.filterInvites}>
            <Link to='/admin/invites' onClick={this._allHandler}>All</Link>
            <Link to='/admin/invites?accepted=true' onClick={this._acceptedHandler}>Accepted</Link>
            <Link to='/admin/invites?accepted=false' onClick={this._unacceptedHandler}>
              Unaccepted
            </Link>
          </div>
          { this.renderInvites() }
        </div>
      </ContentLayout>
    )
  }

  onAllClicked() {
    this.props.dispatch(getInvites())
  }

  onAcceptedClicked() {
    this.props.dispatch(getInvites('accepted'))
  }

  onUnacceptedClicked() {
    this.props.dispatch(getInvites('unaccepted'))
  }

  onAcceptUserClicked(email) {
    this.props.dispatch(acceptUser(email))
  }
}
