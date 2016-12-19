import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'
import FlatButton from '../material/flat-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import form from '../forms/form.jsx'
import CheckBox from '../material/check-box.jsx'
import TextField from '../material/text-field.jsx'

import {
  composeValidators,
  minLength,
  maxLength,
  regex,
  required,
} from '../forms/validators'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
} from '../../shared/constants'

import { getPermissionsIfNeeded, setPermissions } from './action-creators'

@form()
class UserPermissionsForm extends React.Component {
  render() {
    const { isSelf, onSubmit, bindCheckable } = this.props
    const inputProps = {
      tabIndex: 0,
    }
    return (<form noValidate={true} onSubmit={onSubmit}>
      <CheckBox {...bindCheckable('editPermissions')} label='Edit permissions'
          inputProps={inputProps} disabled={isSelf}/>
      <CheckBox {...bindCheckable('debug')} label='Debug' inputProps={inputProps}/>
      <CheckBox {...bindCheckable('acceptInvites')} label='Accept beta invites'
          inputProps={inputProps}/>
      <CheckBox {...bindCheckable('editAllChannels')} label='Edit all channels'
          inputProps={inputProps}/>
      <CheckBox {...bindCheckable('banUsers')} label='Ban users'
          inputProps={inputProps}/>
    </form>)
  }
}

@connect(state => ({ permissions: state.permissions, auth: state.auth }))
export class PermissionsResults extends React.Component {
  _form = null;
  _setForm = elem => { this._form = elem };

  componentDidMount() {
    const { username } = this.props.params
    this.props.dispatch(getPermissionsIfNeeded(username))
  }

  componentDidUpdate(prevProps) {
    const { username: oldUsername } = prevProps.params
    const { username: newUsername } = this.props.params

    if (oldUsername !== newUsername) {
      this.props.dispatch(getPermissionsIfNeeded(newUsername))
    }
  }

  render() {
    const {
      permissions: { users },
      params: { username },
    } = this.props
    const user = users.get(username)
    if (!user || user.isRequesting) {
      return <LoadingIndicator />
    }

    if (user.lastError) {
      return <p>{user.lastError.message}</p>
    }

    const model = {
      editPermissions: user.editPermissions,
      debug: user.debug,
      acceptInvites: user.acceptInvites,
      editAllChannels: user.editAllChannels,
      banUsers: user.banUsers,
    }

    return (<div className={styles.saveForm}>
      <h3>Set permissions for {username}</h3>
      <UserPermissionsForm
          ref={this._setForm}
          isSelf={username === this.props.auth.user.name}
          model={model}
          onSubmit={this.onSubmit}/>
      <FlatButton label='Save' color='accent' tabIndex={0} onClick={this.onSaveClick} />
    </div>)
  }

  onSaveClick = () => {
    this._form.submit()
  };

  onSubmit = () => {
    const { username } = this.props.params
    const values = this._form.getModel()
    this.props.dispatch(setPermissions(username, values))
  };
}

const usernameValidator = composeValidators(
    required('Enter a username'),
    minLength(USERNAME_MINLENGTH, `Enter at least ${USERNAME_MINLENGTH} characters`),
    maxLength(USERNAME_MAXLENGTH, `Enter at most ${USERNAME_MAXLENGTH} characters`),
    regex(USERNAME_PATTERN, 'Username contains invalid characters'))

@form({
  username: usernameValidator,
})
class SearchForm extends React.Component {
  render() {
    const { onSubmit, bindInput } = this.props
    return (<form noValidate={true} onSubmit={onSubmit}>
      <TextField {...bindInput('username')} label='Username' floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}/>
    </form>)
  }
}

@connect()
export class PermissionsFind extends React.Component {
  _form = null;
  _setForm = elem => { this._form = elem };

  render() {
    const model = {
      username: this.props.params.username
    }
    return (
      <ContentLayout title={'Permissions'}>
        <div className={styles.permissions}>
          <div>
            <h3>Find user</h3>
            <SearchForm ref={this._setForm} model={model} onSubmit={this.onSubmit} />
            <FlatButton label='Find' color='accent' tabIndex={0} onClick={this.onFindClick} />
          </div>
          { this.props.children }
        </div>
      </ContentLayout>
    )
  }

  onFindClick = () => {
    this._form.submit()
  };

  onSubmit = () => {
    const values = this._form.getModel()
    const username = values.username
    this.props.dispatch(
        routerActions.push(`/admin/permissions/${encodeURIComponent(username)}`))
  };
}
