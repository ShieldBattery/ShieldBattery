import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import form from '../forms/form.jsx'
import CheckBox from '../material/check-box.jsx'

import { getPermissionsIfNeeded, setPermissions } from './action-creators'

const Container = styled.div``

@form()
class UserPermissionsForm extends React.Component {
  render() {
    const { isSelf, onSubmit, bindCheckable } = this.props
    const inputProps = {
      tabIndex: 0,
    }
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <CheckBox
          {...bindCheckable('editPermissions')}
          label='Edit permissions'
          inputProps={inputProps}
          disabled={isSelf}
        />
        <CheckBox {...bindCheckable('debug')} label='Debug' inputProps={inputProps} />
        <CheckBox
          {...bindCheckable('acceptInvites')}
          label='Accept beta invites'
          inputProps={inputProps}
        />
        <CheckBox
          {...bindCheckable('editAllChannels')}
          label='Edit all channels'
          inputProps={inputProps}
        />
        <CheckBox {...bindCheckable('banUsers')} label='Ban users' inputProps={inputProps} />
        <CheckBox {...bindCheckable('manageMaps')} label='Manage maps' inputProps={inputProps} />
        <CheckBox
          {...bindCheckable('manageMapPools')}
          label='Manage matchmaking map pools'
          inputProps={inputProps}
        />
        <CheckBox {...bindCheckable('deleteMaps')} label='Delete maps' inputProps={inputProps} />
      </form>
    )
  }
}

@connect(state => ({ permissions: state.permissions, auth: state.auth }))
export default class PermissionsResult extends React.Component {
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  componentDidMount() {
    const { username } = this.props
    this.props.dispatch(getPermissionsIfNeeded(username))
  }

  componentDidUpdate(prevProps) {
    const { username: oldUsername } = prevProps
    const { username: newUsername } = this.props

    if (oldUsername !== newUsername) {
      this.props.dispatch(getPermissionsIfNeeded(newUsername))
    }
  }

  render() {
    const {
      permissions: { users },
      username,
    } = this.props
    const user = users.get(username)
    if (!user || user.isRequesting) {
      return <LoadingIndicator />
    }

    if (user.lastError) {
      return <p>{user.lastError.message}</p>
    }

    const model = user.toObject()

    return (
      <Container>
        <h3>Set permissions for {username}</h3>
        <UserPermissionsForm
          ref={this._setForm}
          isSelf={username === this.props.auth.user.name}
          model={model}
          onSubmit={this.onSubmit}
        />
        <FlatButton label='Save' color='accent' tabIndex={0} onClick={this.onSaveClick} />
      </Container>
    )
  }

  onSaveClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const { username } = this.props
    const values = this._form.getModel()
    this.props.dispatch(setPermissions(username, values))
  }
}
