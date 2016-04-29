import React from 'react'
import styles from './beta.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import composeValidators from '../forms/compose-validators'
import minLengthValidator from '../forms/min-length-validator'
import maxLengthValidator from '../forms/max-length-validator'
import regexValidator from '../forms/regex-validator'
import {
  EMAIL_MINLENGTH,
  EMAIL_MAXLENGTH,
  EMAIL_PATTERN,
} from '../../shared/constants'

import { createInvite } from './action-creators'

class BetaSignup extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this.state = {
      formSubmitted: false
    }
  }

  renderDoneMessage() {
    return (<span>
        Thank you for signing up. You will be notified by email when you receive beta access.
    </span>)
  }

  renderSignupForm() {
    const button = (<RaisedButton type='button' label='Sign up'
        onClick={e => this.onSignUpClicked(e)} tabIndex={1}/>)

    const emailValidator = composeValidators(
      minLengthValidator(EMAIL_MINLENGTH,
          `Use at least ${EMAIL_MINLENGTH} characters`),
      maxLengthValidator(EMAIL_MAXLENGTH,
          `Use at most ${EMAIL_MAXLENGTH} characters`),
      regexValidator(EMAIL_PATTERN,
          'Enter a valid email address')
    )

    const signupForm = <ValidatedForm ref='form' formTitle='Sign up' buttons={button}
        onSubmitted={values => this.onSubmitted(values)}>
      <h5>Required</h5>
      <ValidatedText label='Email address' floatingLabel={true} name='email' tabIndex={1}
          autoCapitalize='off' autoCorrect='off' spellCheck={false}
          required={true} requiredMessage='Enter an email address'
          validator={emailValidator}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <h5>Optional</h5>
      <ValidatedText label='TeamLiquid.net username' floatingLabel={true} name='teamliquidName'
          tabIndex={1} required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='Main operating system' floatingLabel={true} name='os' tabIndex={1}
          required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='Main browser' floatingLabel={true} name='browser' tabIndex={1}
          required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='Graphics card' floatingLabel={true} name='graphics' tabIndex={1}
          required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      {/* TODO(2Pac): Make a radio component */}
      <ValidatedText label='Able to host games so far in BW?' floatingLabel={true} name='canHost'
          tabIndex={1} required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
    </ValidatedForm>

    return signupForm
  }

  renderCardContents() {
    if (this.state.formSubmitted) {
      return this.renderDoneMessage()
    } else {
      return this.renderSignupForm()
    }
  }

  render() {
    return (
      <div className={styles.signup}>
        <Card className={styles.signupCard}>{this.renderCardContents()}</Card>
      </div>
    )
  }

  onSignUpClicked() {
    this.refs.form.trySubmit()
  }

  onSubmitted(values) {
    this.setState({ formSubmitted: true })

    let canHost = values.get('canHost')
    if (canHost.toLowerCase() === 'yes') {
      canHost = true
    } else {
      canHost = false
    }

    this.context.store.dispatch(createInvite({
      email: values.get('email'),
      teamliquidName: values.get('teamliquidName'),
      os: values.get('os'),
      browser: values.get('browser'),
      graphics: values.get('graphics'),
      canHost,
    }))
  }
}

export default BetaSignup
