import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'
import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import TextField from '../material/text-field.jsx'
import BanUsers from './bans.jsx'
import PermissionsResult from './permissions.jsx'
import { ConditionalRoute } from '../navigation/custom-routes.jsx'

import { composeValidators, minLength, maxLength, regex, required } from '../forms/validators'
import { CanViewUserProfileFilter } from './admin-route-filters.jsx'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
} from '../../app/common/constants'

@connect(state => ({ auth: state.auth }))
export class UserProfile extends React.Component {
  render() {
    const { auth: { permissions: perms }, match: { params: { username } } } = this.props

    const children = []
    if (perms.editPermissions) {
      children.push(<PermissionsResult key="perms" username={username} />)
    }
    if (perms.banUsers) {
      children.push(<BanUsers key="bans" username={username} />)
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
          label="Username"
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

@connect()
export class UserFind extends React.Component {
  _form = null
  _setForm = elem => {
    this._form = elem
  }

  render() {
    const model = {
      username: this.props.match.params.username,
    }
    return (
      <ContentLayout title={'Users'}>
        <div className={styles.users}>
          <div>
            <h3>Find user</h3>
            <SearchForm ref={this._setForm} model={model} onSubmit={this.onSubmit} />
            <FlatButton label="Find" color="accent" tabIndex={0} onClick={this.onFindClick} />
          </div>
          <ConditionalRoute
            path="/admin/users/:username"
            filters={[CanViewUserProfileFilter]}
            component={UserProfile}
          />
        </div>
      </ContentLayout>
    )
  }

  onFindClick = () => {
    this._form.submit()
  }

  onSubmit = () => {
    const values = this._form.getModel()
    const username = values.username
    this.props.dispatch(routerActions.push(`/admin/users/${encodeURIComponent(username)}`))
  }
}
