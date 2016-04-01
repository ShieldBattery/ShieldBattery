import React from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
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
import styles from './login.css'
import {
  USERNAME_MINLENGTH,
  USERNAME_MAXLENGTH,
  USERNAME_PATTERN,
  PASSWORD_MINLENGTH,
} from '../../shared/constants'

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
        minLengthValidator(USERNAME_MINLENGTH,
            `Enter at least ${USERNAME_MINLENGTH} characters`),
        maxLengthValidator(USERNAME_MAXLENGTH,
            `Enter at most ${USERNAME_MAXLENGTH} characters`),
        regexValidator(USERNAME_PATTERN,
            'Username contains invalid characters')
      )
      const passwordValidator = minLengthValidator(PASSWORD_MINLENGTH,
          `Enter at least ${PASSWORD_MINLENGTH} characters`)

      cardContents = (
        <ValidatedForm ref='form'
            formTitle={'Log in'}
            errorText={errContents}
            errorsClassName={styles.errors}
            fieldsClassName={styles.fields}
            buttons={buttons}
            onSubmitted={values => this.onSubmitted(values)}>
          <ValidatedText className={styles.textFields} label='Username' floatingLabel={true}
              name='username' tabIndex={1}
              autoCapitalize='off' autoCorrect='off' spellCheck={false}
              required={true} requiredMessage='Enter a username'
              validator={usernameValidator}
              onEnterKeyDown={e => this.onLogInClicked()}/>
            <ValidatedText className={styles.textFields} label='Password' floatingLabel={true}
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
    const query = {
      ...this.props.location.query,
      username: this.refs.form.getValueOf('username'),
    }
    this.props.dispatch(routeActions.push({ pathname: '/signup', query }))
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
