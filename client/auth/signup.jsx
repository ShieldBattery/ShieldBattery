import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import { redirectIfLoggedIn } from './auth-utils'
import Card from '../material/card.jsx'
import FlatButton from '../material/flat-button.jsx'
import RaisedButton from '../material/raised-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import composeValidators from '../forms/compose-validators'
import minLengthValidator from '../forms/min-length-validator'
import maxLengthValidator from '../forms/max-length-validator'
import regexValidator from '../forms/regex-validator'
import matchOtherValidator from '../forms/match-other-validator'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
  EMAIL_MINLENGTH,
  EMAIL_MAXLENGTH,
  EMAIL_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../shared/constants'
import auther from './auther'
import styles from './login.css'

@connect(state => ({ auth: state.auth }))
class Signup extends React.Component {
  constructor(props, context) {
    super(props, context)
    this.state = {
      reqId: null,
    }
  }

  componentDidMount() {
    redirectIfLoggedIn(this.props)
  }

  componentWillReceiveProps(nextProps) {
    redirectIfLoggedIn(nextProps)
  }

  render() {
    const { auth, location } = this.props
    if (auth.authChangeInProgress) {
      return <Card><span>Please wait...</span></Card>
    }

    const button = (<RaisedButton type='button' label='Create account'
        onClick={e => this.onSignUpClicked(e)} tabIndex={1}/>)

    const usernameValidator = composeValidators(
      minLengthValidator(USERNAME_MINLENGTH,
          `Use at least ${USERNAME_MINLENGTH} characters`),
      maxLengthValidator(USERNAME_MAXLENGTH,
          `Use at most ${USERNAME_MAXLENGTH} characters`),
      regexValidator(USERNAME_PATTERN,
          'Username contains invalid characters')
    )
    const emailValidator = composeValidators(
      minLengthValidator(EMAIL_MINLENGTH,
          `Use at least ${EMAIL_MINLENGTH} characters`),
      maxLengthValidator(EMAIL_MAXLENGTH,
          `Use at most ${EMAIL_MAXLENGTH} characters`),
      regexValidator(EMAIL_PATTERN,
          'Enter a valid email address')
    )
    const passwordValidator = minLengthValidator(PASSWORD_MINLENGTH,
        `Use at least ${PASSWORD_MINLENGTH} characters`)
    const confirmPasswordValidator = matchOtherValidator('password',
        'Passwords do not match')

    let errContents
    const failure = auth.lastFailure
    const reqId = this.state.reqId
    if (reqId && failure && failure.reqId === reqId) {
      errContents = `Error: ${failure.err}`
    }

    return (<div className={styles.content}>
      <Card zDepth={1}>
        <ValidatedForm formTitle='Create account' errorText={errContents}
            errorClassName={styles.errors} ref='form' buttons={button}
            onSubmitted={values => this.onSubmitted(values)}>
          <ValidatedText label='Username' floatingLabel={true} name='username' tabIndex={1}
              defaultValue={location.query.username}
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a username'
              validator={usernameValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText label='Email address' floatingLabel={true} name='email' tabIndex={1}
              required={true} requiredMessage='Enter an email address'
              defaultValue={location.query.email}
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              validator={emailValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText label='Password' floatingLabel={true} name='password' tabIndex={1}
              type='password' autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a password'
              validator={passwordValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText label='Confirm password' floatingLabel={true} name='confirmPassword'
              tabIndex={1} type='password' autoCapitalize='off' autoCorrect='off'
              spellCheck={false}
              required={true} requiredMessage='Confirm your password'
              validator={confirmPasswordValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText label='Invite code' floatingLabel={true} name='token'
              tabIndex={1} autoCapitalize='off' autoCorrect='off' spellCheck={false}
              defaultValue={location.query.token}
              required={true} requiredMessage='Enter your token'
              onEnterKeyDown={e => this.onSignUpClicked()}/>
        </ValidatedForm>
      </Card>
      <div className={styles.bottomAction}>
        <p>Already have an account?</p>
        <FlatButton label='Log in' onClick={e => this.onLogInClicked(e)} tabIndex={2} />
      </div>
    </div>)
  }

  onSignUpClicked() {
    this.refs.form.trySubmit()
  }

  onLogInClicked() {
    const query = {
      ...this.props.location.query,
    }
    this.props.dispatch(routerActions.push({ pathname: '/login', query }))
  }

  onSubmitted(values) {
    const { id, action } = auther.signUp(values.get('username'), values.get('email'),
        values.get('password'), values.get('token'))
    this.setState({
      reqId: id
    })
    this.props.dispatch(action)
  }
}


export default Signup
