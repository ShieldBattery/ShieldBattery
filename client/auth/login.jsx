import React from 'react'
import Card from '../material/card.jsx'
import { FlatButton } from 'material-ui'
import authStore from './auth-store'
import auther from './auther'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import ValidatedCheckbox from '../forms/validated-checkbox.jsx'
import composeValidators from '../forms/compose-validators'
import minLengthValidator from '../forms/min-length-validator'
import maxLengthValidator from '../forms/max-length-validator'
import regexValidator from '../forms/regex-validator'
import matchOtherValidator from '../forms/match-other-validator'
import constants from '../../shared/constants'

class Login extends React.Component {
  constructor() {
    super()
    this.authStoreListener = () => this.onAuthChange()
    this.state = {
      authChangeInProgress: false,
      reqId: null,
      failure: null,
    }
  }

  componentDidMount() {
    this.checkLoggedIn()
    authStore.register(this.authStoreListener)
  }

  componentWillUnmount() {
    authStore.unregister(this.authStoreListener)
  }

  checkLoggedIn() {
    if (authStore.isLoggedIn) {
      // We're logged in now, hooray!
      // Go wherever the user was intending to go before being directed here (or home)
      let nextPath = this.context.router.getCurrentQuery().nextPath || 'home'
      this.context.router.replaceWith(nextPath)
      return true
    }

    return false
  }

  onAuthChange() {
    if (this.checkLoggedIn()) return

    this.setState({
      authChangeInProgress: authStore.authChangeInProgress,
      failure: authStore.hasFailure(this.state.reqId) ? authStore.lastFailure.err : null
    })
  }

  render() {
    let cardContents
    if (this.state.authChangeInProgress) {
      cardContents = <span>Please wait...</span>
    } else {
      let errContents
      if (this.state.failure) {
        errContents = `Error: ${this.state.failure.error}`
      }

      let buttons = [
        <FlatButton type="button" label="Sign up" key='signup-btn' secondary={true}
            onTouchTap={e => this.onSignUpClicked(e)} tabIndex={2}/>,
        <FlatButton type ="button" label="Log in" key='login-btn' primary={true}
            onTouchTap={e => this.onLogInClicked(e)} tabIndex={1}/>,
      ]

      let usernameValidator = composeValidators(
        minLengthValidator(constants.USERNAME_MINLENGTH,
            `Enter at least ${constants.USERNAME_MINLENGTH} characters`),
        maxLengthValidator(constants.USERNAME_MAXLENGTH,
            `Enter at most ${constants.USERNAME_MAXLENGTH} characters`),
        regexValidator(constants.USERNAME_PATTERN,
            `Username contains invalid characters`)
      )
      let passwordValidator = minLengthValidator(constants.PASSWORD_MINLENGTH,
          `Enter at least ${constants.PASSWORD_MINLENGTH} characters`)

      cardContents = (
        <ValidatedForm formTitle={'Log in'} errorText={errContents} ref='form'
            buttons={buttons} onSubmitted={values => this.onSubmitted(values)}>
          <ValidatedText floatingLabelText='Username' name='username' tabIndex={1}
              required={true} requiredMessage='Enter a username'
              validator={usernameValidator}
              onEnterKeyDown={e => this.onLogInClicked()}/>
          <ValidatedText floatingLabelText='Password' name='password' tabIndex={1} type='password'
              required={true} requiredMessage='Enter a password'
              validator={passwordValidator}
              onEnterKeyDown={e => this.onLogInClicked()}/>
          <ValidatedCheckbox label='Remember me' name='remember' tabIndex={1} />
        </ValidatedForm>
      )
    }

    return <Card zDepth={1} className="card-form">{cardContents}</Card>
  }

  onSignUpClicked() {
    this.context.router.transitionTo('signup', null,
        Object.assign(this.context.router.getCurrentQuery(), {
          username: this.refs.form.getValueOf('username')
        }))
  }

  onLogInClicked() {
    this.refs.form.trySubmit()
  }

  onSubmitted(values) {
    let id = auther.logIn(values.get('username'), values.get('password'), values.get('remember'))
    this.setState({
      reqId: id
    })
  }
}

Login.contextTypes = {
  router: React.PropTypes.func
}

export default Login
