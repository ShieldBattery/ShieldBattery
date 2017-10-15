import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import queryString from 'query-string'
import { Range } from 'immutable'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'

import { getInvites, acceptUser } from './action-creators'

const LIMIT = 25

@connect(state => ({ invites: state.invites }))
export default class Invites extends React.Component {
  _retrieveData() {
    const { accepted, page } = queryString.parse(this.props.location.search)
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
    const prevSearch = queryString.parse(prevProps.location.search)
    const search = queryString.parse(this.props.location.search)
    if (prevSearch.accepted !== search.accepted || prevSearch.page !== search.page) {
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
    const { total } = this.props.invites
    const numOfPages = Math.ceil(total / LIMIT)
    const { accepted, page } = queryString.parse(this.props.location.search)

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
