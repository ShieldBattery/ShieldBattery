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
import constants from '../../shared/constants'

import { getPermissionsIfNeeded, setPermissions } from './action-creators'

@connect(state => ({ permissions: state.permissions, auth: state.auth }))
export default class Permissions extends React.Component {
  constructor(props) {
    super(props)

    this._findUserHandler = ::this.onFindUserClicked
    this._savePermissionsHandler = ::this.onSavePermissionsClicked
  }

  componentDidMount() {
    const { username } = this.props.routeParams
    if (username) {
      this.props.dispatch(getPermissionsIfNeeded(decodeURIComponent(username)))
    }
  }

  componentWillReceiveProps(nextProps) {
    const { username: oldUsername } = this.props.routeParams
    const { username: newUsername } = nextProps.routeParams

    if (oldUsername !== newUsername) {
      if (newUsername) {
        this.props.dispatch(getPermissionsIfNeeded(decodeURIComponent(newUsername)))
      }
    }
  }

  renderResults() {
    const { location, permissions } = this.props
    if (location.pathname === '/admin/permissions') return null
    if (permissions.requestingPermissions) {
      return <p>Please wait...</p>
    }

    const { username } = this.props.routeParams
    if (!permissions.users.has(username)) {
      return <p>No results</p>
    }

    const perms = permissions.users.get(username)
    const saveButton = <FlatButton label='Save' color='accent' tabIndex={1}
        onClick={this._savePermissionsHandler} />

    return (
      <ValidatedForm ref='saveForm' formTitle={'Set permissions'}
          className={styles.saveForm} buttons={saveButton}
          onSubmitted={values => this.onSaveSubmitted(values)}>
        <ValidatedCheckbox label='Edit permissions' name='editPermissions' tabIndex={1}
            disabled={username === this.props.auth.user.name}
            defaultChecked={perms.editPermissions} />
        <ValidatedCheckbox label='Debug' name='debug' tabIndex={1}
            defaultChecked={perms.debug} />
        <ValidatedCheckbox label='Accept beta invites' name='acceptInvites' tabIndex={1}
            defaultChecked={perms.acceptInvites} />
      </ValidatedForm>
    )
  }

  render() {
    const findButton = <FlatButton label='Find' color='accent' tabIndex={1}
        onClick={this._findUserHandler} />

    const usernameValidator = composeValidators(
      minLengthValidator(constants.USERNAME_MINLENGTH,
          `Enter at least ${constants.USERNAME_MINLENGTH} characters`),
      maxLengthValidator(constants.USERNAME_MAXLENGTH,
          `Enter at most ${constants.USERNAME_MAXLENGTH} characters`),
      regexValidator(constants.USERNAME_PATTERN,
          `Username contains invalid characters`)
    )

    return (
      <ContentLayout title={'Permissions'}>
        <div className={styles.permissions}>
          <ValidatedForm ref='findForm' formTitle={'Find user:'} className={styles.findForm}
              titleClassName={styles.findTitle} fieldsClassName={styles.findFields}
              buttons={findButton} onSubmitted={values => this.onFindSubmitted(values)}>
            <ValidatedText label='Username' floatingLabel={true}
                name='username' tabIndex={1}
                autoCapitalize='off' autoCorrect='off' spellCheck={false}
                required={true} requiredMessage='Enter a username'
                validator={usernameValidator}
                onEnterKeyDown={e => this._findUserHandler()}/>
          </ValidatedForm>
          { this.renderResults() }
        </div>
      </ContentLayout>
    )
  }

  onFindUserClicked() {
    this.refs.findForm.trySubmit()
  }

  onFindSubmitted(values) {
    const username = values.get('username')
    this.props.dispatch(routeActions.push(`/admin/permissions/${encodeURIComponent(username)}`))
  }

  onSavePermissionsClicked() {
    this.refs.saveForm.trySubmit()
  }

  onSaveSubmitted(values) {
    this.props.dispatch(setPermissions(this.state.username, {
      editPermissions: values.get('editPermissions'),
      debug: values.get('debug'),
      acceptInvites: values.get('acceptInvites')
    }))
  }
}
