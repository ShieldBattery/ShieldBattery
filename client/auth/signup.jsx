import React from 'react'
import { connect } from 'react-redux'
import { pushPath } from 'redux-simple-router'
import { stringify } from 'query-string'
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
import constants from '../../shared/constants'
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

    const button = (<RaisedButton type='button' label='Sign up'
        onClick={e => this.onSignUpClicked(e)} tabIndex={1}/>)

    const usernameValidator = composeValidators(
      minLengthValidator(constants.USERNAME_MINLENGTH,
          `Use at least ${constants.USERNAME_MINLENGTH} characters`),
      maxLengthValidator(constants.USERNAME_MAXLENGTH,
          `Use at most ${constants.USERNAME_MAXLENGTH} characters`),
      regexValidator(constants.USERNAME_PATTERN,
          `Username contains invalid characters`)
    )
    const emailValidator = composeValidators(
      minLengthValidator(constants.EMAIL_MINLENGTH,
          `Use at least ${constants.EMAIL_MINLENGTH} characters`),
      maxLengthValidator(constants.EMAIL_MAXLENGTH,
          `Use at most ${constants.EMAIL_MAXLENGTH} characters`),
      regexValidator(constants.EMAIL_PATTERN,
          `Enter a valid email address`)
    )
    const passwordValidator = minLengthValidator(constants.PASSWORD_MINLENGTH,
        `Use at least ${constants.PASSWORD_MINLENGTH} characters`)
    const confirmPasswordValidator = matchOtherValidator('password',
        `Passwords do not match`)

    let errContents
    const failure = auth.lastFailure
    const reqId = this.state.reqId
    if (reqId && failure && failure.reqId === reqId) {
      errContents = `Error: ${failure.err}`
    }

    return (<div className={styles.content}>
      <Card zDepth={1}>
        <ValidatedForm formTitle='Sign up' errorText={errContents} errorClassName={styles.errors}
            ref='form' buttons={button} onSubmitted={values => this.onSubmitted(values)}>
          <ValidatedText hintText='Username' floatingLabel={true} name='username' tabIndex={1}
              defaultValue={location.query.username}
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a username'
              validator={usernameValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText hintText='Email address' floatingLabel={true} name='email' tabIndex={1}
              required={true} requiredMessage='Enter an email address'
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              validator={emailValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText hintText='Password' floatingLabel={true} name='password' tabIndex={1}
              type='password' autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a password'
              validator={passwordValidator}
              onEnterKeyDown={e => this.onSignUpClicked()}/>
          <ValidatedText hintText='Confirm password' floatingLabel={true} name='confirmPassword'
              tabIndex={1} type='password' autoCapitalize='off' autoCorrect='off'
              spellCheck={false}
              required={true} requiredMessage='Confirm your password'
              validator={confirmPasswordValidator}
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
    const query = stringify({
      ...this.props.location.query,
    })
    this.props.dispatch(pushPath('/login?' + query, null))
  }

  onSubmitted(values) {
    const { id, action } =
        auther.signUp(values.get('username'), values.get('email'), values.get('password'))
    this.setState({
      reqId: id
    })
    this.props.dispatch(action)
  }
}


export default Signup
