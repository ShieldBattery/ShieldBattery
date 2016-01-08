import React from 'react'
import { connect } from 'react-redux'
import { pushPath } from 'redux-simple-router'
import { stringify } from 'query-string'
import { redirectIfLoggedIn } from './auth-utils'
import Card from '../material/card.jsx'
import FlatButton from '../material/flat-button.jsx'
import RaisedButton from '../material/raised-button.jsx'
import auther from './auther'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import ValidatedCheckbox from '../forms/validated-checkbox.jsx'
import composeValidators from '../forms/compose-validators'
import minLengthValidator from '../forms/min-length-validator'
import maxLengthValidator from '../forms/max-length-validator'
import regexValidator from '../forms/regex-validator'
import constants from '../../shared/constants'
import styles from './login.css'

@connect(state => ({ auth: state.auth }))
class Login extends React.Component {
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
    const { auth } = this.props
    let cardContents
    if (auth.authChangeInProgress) {
      cardContents = <span>Please wait...</span>
    } else {
      let errContents
      const failure = auth.lastFailure
      const reqId = this.state.reqId
      if (reqId && failure && failure.reqId === reqId) {
        errContents = `Error: ${failure.err}`
      }

      const buttons = [
        <RaisedButton label='Log in' key='login-btn'
            onClick={e => this.onLogInClicked(e)} tabIndex={1}/>,
      ]

      const usernameValidator = composeValidators(
        minLengthValidator(constants.USERNAME_MINLENGTH,
            `Enter at least ${constants.USERNAME_MINLENGTH} characters`),
        maxLengthValidator(constants.USERNAME_MAXLENGTH,
            `Enter at most ${constants.USERNAME_MAXLENGTH} characters`),
        regexValidator(constants.USERNAME_PATTERN,
            `Username contains invalid characters`)
      )
      const passwordValidator = minLengthValidator(constants.PASSWORD_MINLENGTH,
          `Enter at least ${constants.PASSWORD_MINLENGTH} characters`)

      cardContents = (
        <ValidatedForm ref='form'
            formTitle={'Log in'}
            errorText={errContents}
            errorsClassName={styles.errors}
            fieldsClassName={styles.fields}
            buttons={buttons}
            onSubmitted={values => this.onSubmitted(values)}>
          <ValidatedText className={styles.textFields} hintText='Username' floatingLabel={true}
              name='username' tabIndex={1}
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a username'
              validator={usernameValidator}
              onEnterKeyDown={e => this.onLogInClicked()}/>
          <ValidatedText className={styles.textFields} hintText='Password' floatingLabel={true}
              name='password' tabIndex={1} type='password'
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a password'
              validator={passwordValidator}
              onEnterKeyDown={e => this.onLogInClicked()}/>
          <ValidatedCheckbox className={styles.checkboxes} label='Remember me'
              name='remember' tabIndex={1} />
        </ValidatedForm>
      )
    }

    return (<div className={styles.content}>
      <Card>{cardContents}</Card>
      <div className={styles.bottomAction}>
        <p>Don't have an account?</p>
        <FlatButton label='Sign up' onClick={e => this.onSignUpClicked(e)} tabIndex={2}/>
      </div>
    </div>)
  }

  onSignUpClicked() {
    const query = stringify({
      ...this.props.location.query,
      username: this.refs.form.getValueOf('username'),
    })
    this.props.dispatch(pushPath('/signup?' + query, null))
  }

  onLogInClicked() {
    this.refs.form.trySubmit()
  }

  onSubmitted(values) {
    const { id, action } =
        auther.logIn(values.get('username'), values.get('password'), values.get('remember'))
    this.setState({
      reqId: id
    })
    this.props.dispatch(action)
  }
}

export default Login
