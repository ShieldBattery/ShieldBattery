import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { colorTextSecondary } from '../styles/colors'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import form from '../forms/form.jsx'
import Option from '../material/select/option.jsx'
import Select from '../material/select/select.jsx'
import TextField from '../material/text-field.jsx'

import { getBanHistoryIfNeeded, banUser } from './action-creators'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const BanTable = styled.table`
  text-align: left;

  th,
  td {
    width: 100px;
    max-width: 150px;
    padding: 5px;

    border: 5px solid transparent;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: no-wrap;
  }

  th {
    color: ${colorTextSecondary};
    font-weight: 500;
  }
`

const BanHistory = styled.div``

@form()
class BanUserForm extends React.Component {
  render() {
    const { onSubmit, bindCustom, bindInput } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <Select {...bindCustom('banLength')} label='Ban length' tabIndex={0}>
          <Option value={3} text='3 Hours' />
          <Option value={24} text='1 Day' />
          <Option value={24 * 7} text='1 Week' />
          <Option value={24 * 7 * 4} text='1 Month' />
          <Option value={24 * 365 * 999} text='Permanent!' />
        </Select>
        <TextField
          {...bindInput('banReason')}
          label='Ban reason'
          floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoComplete: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
      </form>
    )
  }
}

@connect(state => ({ bans: state.bans, auth: state.auth }))
export default class BanUsers extends React.Component {
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  componentDidMount() {
    const { username } = this.props
    this.props.dispatch(getBanHistoryIfNeeded(username))
  }

  componentDidUpdate(prevProps) {
    const { username: oldUsername } = prevProps
    const { username: newUsername } = this.props

    if (oldUsername !== newUsername) {
      this.props.dispatch(getBanHistoryIfNeeded(newUsername))
    }
  }

  renderBanRow(ban) {
    return (
      <tr key={ban.startTime}>
        <td>{dateFormat.format(ban.startTime)}</td>
        <td>{dateFormat.format(ban.endTime)}</td>
        <td>{ban.bannedBy}</td>
        <td>{ban.reason}</td>
      </tr>
    )
  }

  renderBanHistory(user) {
    const { bans } = user
    if (bans.isEmpty()) return <p>This user has not been banned before.</p>

    return (
      <BanTable>
        <thead>
          <tr>
            <th>Start time</th>
            <th>End time</th>
            <th>Banned by</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>{bans.map(b => this.renderBanRow(b))}</tbody>
      </BanTable>
    )
  }

  renderBanUserForm(user) {
    if (this.props.username === this.props.auth.user.name) return null

    return [
      <BanUserForm
        key='banUserForm'
        ref={this._setForm}
        model={{ banLength: 24 }}
        onSubmit={this.onSubmit}
      />,
      <FlatButton
        key='banUser'
        label='Ban'
        color='accent'
        tabIndex={0}
        onClick={this.onBanClick}
      />,
    ]
  }

  render() {
    const {
      bans: { users },
      username,
    } = this.props
    const user = users.get(username)
    if (!user || user.isRequesting) {
      return <LoadingIndicator />
    }

    if (user.lastError) {
      return <p>{user.lastError.message}</p>
    }

    return (
      <BanHistory>
        <h3>Ban history for {username}</h3>
        {this.renderBanHistory(user)}
        {this.renderBanUserForm(user)}
      </BanHistory>
    )
  }

  onBanClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const { username } = this.props
    const { banLength, banReason } = this._form.getModel()
    this.props.dispatch(banUser(username, banLength, banReason))
  }
}
