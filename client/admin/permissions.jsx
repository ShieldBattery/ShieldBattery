import React from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
import styles from './admin.css'

import ContentLayout from '../content/content-layout.jsx'
import FlatButton from '../material/flat-button.jsx'
import ValidatedCheckbox from '../forms/validated-checkbox.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'

import composeValidators from '../forms/compose-validators'
import minLengthValidator from '../forms/min-length-validator'
import maxLengthValidator from '../forms/max-length-validator'
import regexValidator from '../forms/regex-validator'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
} from '../../shared/constants'

import { getPermissionsIfNeeded, setPermissions } from './action-creators'

@connect(state => ({ permissions: state.permissions, auth: state.auth }))
export class PermissionsResults extends React.Component {
  constructor(props) {
    super(props)
    this._savePermissionsHandler = ::this.onSavePermissionsClicked
  }

  componentDidMount() {
    const { username } = this.props.routeParams
    this.props.dispatch(getPermissionsIfNeeded(username))
  }

  componentDidUpdate(prevProps) {
    const { username: oldUsername } = prevProps.routeParams
    const { username: newUsername } = this.props.routeParams

    if (oldUsername !== newUsername) {
      this.props.dispatch(getPermissionsIfNeeded(newUsername))
    }
  }

  render() {
    const {
      permissions: { users },
      routeParams: { username },
    } = this.props
    const user = users.get(username)
    if (!user || user.isRequesting) {
      return <p>Please wait...</p>
    }

    if (user.lastError) {
      return <p>{user.lastError.message}</p>
    }

    const saveButton = <FlatButton label='Save' color='accent' tabIndex={0}
        onClick={this._savePermissionsHandler} />

    return (
      <ValidatedForm ref='saveForm' formTitle={`Set permissions for ${username}`}
          className={styles.saveForm} buttons={saveButton}
          onSubmitted={values => this.onSaveSubmitted(values)}>
        <ValidatedCheckbox label='Edit permissions' name='editPermissions' tabIndex={0}
            disabled={username === this.props.auth.user.name}
            defaultChecked={user.editPermissions} />
        <ValidatedCheckbox label='Debug' name='debug' tabIndex={0}
            defaultChecked={user.debug} />
        <ValidatedCheckbox label='Accept beta invites' name='acceptInvites' tabIndex={0}
            defaultChecked={user.acceptInvites} />
      </ValidatedForm>
    )
  }

  onSavePermissionsClicked() {
    this.refs.saveForm.trySubmit()
  }

  onSaveSubmitted(values) {
    const { username } = this.props.routeParams
    this.props.dispatch(setPermissions(username, {
      editPermissions: values.get('editPermissions'),
      debug: values.get('debug'),
      acceptInvites: values.get('acceptInvites')
    }))
  }
}

export class PermissionsFind extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this._findUserHandler = ::this.onFindUserClicked
  }

  render() {
    const findButton = <FlatButton label='Find' color='accent' tabIndex={0}
        onClick={this._findUserHandler} />

    const usernameValidator = composeValidators(
      minLengthValidator(USERNAME_MINLENGTH, `Enter at least ${USERNAME_MINLENGTH} characters`),
      maxLengthValidator(USERNAME_MAXLENGTH, `Enter at most ${USERNAME_MAXLENGTH} characters`),
      regexValidator(USERNAME_PATTERN, 'Username contains invalid characters')
    )

    return (
      <ContentLayout title={'Permissions'}>
        <div className={styles.permissions}>
          <ValidatedForm ref='findForm' formTitle={'Find user:'} className={styles.findForm}
              titleClassName={styles.findTitle} fieldsClassName={styles.findFields}
              buttons={findButton} onSubmitted={values => this.onFindSubmitted(values)}>
            <ValidatedText label='Username' floatingLabel={true}
                name='username' tabIndex={0}
                autoCapitalize='off' autoCorrect='off' spellCheck={false}
                required={true} requiredMessage='Enter a username'
                validator={usernameValidator}
                onEnterKeyDown={e => this._findUserHandler()}/>
          </ValidatedForm>
          { this.props.children }
        </div>
      </ContentLayout>
    )
  }

  onFindUserClicked() {
    this.refs.findForm.trySubmit()
  }

  onFindSubmitted(values) {
    const username = values.get('username')
    this.context.store.dispatch(
        routeActions.push(`/admin/permissions/${encodeURIComponent(username)}`))
  }
}
