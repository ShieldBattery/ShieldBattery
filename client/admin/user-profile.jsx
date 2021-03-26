import React from 'react'
import { connect } from 'react-redux'
import { Route } from 'wouter'
import { push } from '../navigation/routing'
import styled from 'styled-components'

import FlatButton from '../material/flat-button'
import form from '../forms/form'
import TextField from '../material/text-field'
import BanUsers from './bans'
import PermissionsResult from './permissions'

import { composeValidators, minLength, maxLength, regex, required } from '../forms/validators'
import { USERNAME_MINLENGTH, USERNAME_MAXLENGTH, USERNAME_PATTERN } from '../../common/constants'

const Container = styled.div`
  padding: 0 20px;
`

@connect(state => ({ auth: state.auth }))
export class UserProfile extends React.Component {
  render() {
    const {
      auth: { permissions: perms },
      params,
    } = this.props

    const username = decodeURIComponent(params.username)

    const children = []
    if (perms.editPermissions) {
      children.push(<PermissionsResult key='perms' username={username} />)
    }
    if (perms.banUsers) {
      children.push(<BanUsers key='bans' username={username} />)
    }

    return <div>{children}</div>
  }
}

const usernameValidator = composeValidators(
  required('Enter a username'),
  minLength(USERNAME_MINLENGTH, `Enter at least ${USERNAME_MINLENGTH} characters`),
  maxLength(USERNAME_MAXLENGTH, `Enter at most ${USERNAME_MAXLENGTH} characters`),
  regex(USERNAME_PATTERN, 'Username contains invalid characters'),
)

@form({
  username: usernameValidator,
})
class SearchForm extends React.Component {
  render() {
    const { onSubmit, bindInput } = this.props
    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <TextField
          {...bindInput('username')}
          label='Username'
          floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
      </form>
    )
  }
}

export class UserFind extends React.Component {
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  render() {
    const model = {
      username: decodeURIComponent(this.props.params.username ?? ''),
    }
    return (
      <Container>
        <div>
          <h3>Find user</h3>
          <SearchForm ref={this._setForm} model={model} onSubmit={this.onSubmit} />
          <FlatButton label='Find' color='accent' tabIndex={0} onClick={this.onFindClick} />
        </div>
        <Route path='/admin/users/:username' component={UserProfile} />
      </Container>
    )
  }

  onFindClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const values = this._form.getModel()
    const username = values.username
    push(`/admin/users/${encodeURIComponent(username)}`)
  }
}
