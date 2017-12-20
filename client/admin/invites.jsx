import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router'
import { Range } from 'immutable'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'

import { getInvites, acceptUser } from './action-creators'

const LIMIT = 25

@connect(state => ({ invites: state.invites }))
export default class Invites extends React.Component {
  _retrieveData() {
    const { location: { query: { accepted, page } } } = this.props
    let type
    if (accepted === 'true') {
      type = 'accepted'
    } else if (accepted === 'false') {
      type = 'unaccepted'
    }

    this.props.dispatch(getInvites(type, LIMIT, page ? page - 1 : 0))
  }

  componentDidMount() {
    this._retrieveData()
  }

  componentDidUpdate(prevProps) {
    if (
      prevProps.location.query.accepted !== this.props.location.query.accepted ||
      prevProps.location.query.page !== this.props.location.query.page
    ) {
      this._retrieveData()
    }
  }

  renderAcceptLink(invitee) {
    return (
      <a href="#" onClick={event => this.onAcceptUserClicked(event, invitee.email)}>
        Accept
      </a>
    )
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
          {invitee.isAccepted ? (
            <a href={`/signup?token=${invitee.token}&email=${encodeURIComponent(invitee.email)}`}>
              Signup Link
            </a>
          ) : (
            <span>{this.renderAcceptLink(invitee)}</span>
          )}
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
        <tbody>{signups.map(e => this.renderInviteeRow(byEmail.get(e)))}</tbody>
      </table>
    )
  }

  renderError() {
    const { lastError } = this.props.invites
    if (!lastError) return null

    return <div className={styles.invitesError}>{lastError.message}</div>
  }

  renderPaging() {
    const { location: { query: { accepted, page } } } = this.props
    const { total } = this.props.invites
    const numOfPages = Math.ceil(total / LIMIT)

    const search =
      accepted === 'true' || accepted === 'false' ? '?accepted=' + accepted + '&page=' : '?page='

    const parsedPage = parseInt(page, 10)
    const pagesLinks = Range(1, numOfPages + 1).map(pageNum => {
      if ((!page && pageNum === 1) || pageNum === parsedPage) {
        return <span key={pageNum}>{pageNum} </span>
      }
      return (
        <Link to={'/admin/invites' + search + pageNum} key={pageNum}>
          {pageNum}{' '}
        </Link>
      )
    })

    return pagesLinks
  }

  render() {
    return (
      <ContentLayout title={'Invites'}>
        <div className={styles.invites}>
          {this.renderError()}
          <div className={styles.filterInvites}>
            <Link to="/admin/invites">All</Link>
            <Link to="/admin/invites?accepted=true">Accepted</Link>
            <Link to="/admin/invites?accepted=false">Unaccepted</Link>
          </div>
          {this.renderInvites()}
          {this.renderPaging()}
        </div>
      </ContentLayout>
    )
  }

  onAcceptUserClicked(event, email) {
    event.preventDefault()
    this.props.dispatch(acceptUser(email))
  }
}
