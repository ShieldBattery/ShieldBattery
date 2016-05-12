import React from 'react'
import { connect } from 'react-redux'
import styles from './beta.css'
import loginStyles from '../auth/login.css'

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

@connect(state => ({ beta: state.beta }))
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
    return (<div className={styles.signupDone}>
        <p className={styles.signupDoneParagraph}>
          Thank you for signing up for the ShieldBattery beta! You will be notified by email or
          TeamLiquid PM when you receive a beta invite.
        </p>

        <p className={styles.signupDoneParagraph}>
          In the meantime, follow our <a href='https://twitter.com/shieldbatterybw'
          target='_blank'>Twitter account</a> for updates, <a
          href='https://us.battle.net/shop/en/product/starcraft' target='_blank'
          rel='nofollow noreferrer'>buy or download</a> Brood War, and ensure you're on the <a
          href='http://ftp.blizzard.com/pub/broodwar/patches/PC/BW-1161.exe' target='_blank'
          rel='nofollow noreferrer'>latest patch</a>.
        </p>
    </div>)
  }

  renderSignupForm() {
    const { beta } = this.props

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

    let errContents
    if (beta.lastError) {
      errContents = `Error: ${beta.lastError.message}`
    }

    const signupForm = <ValidatedForm ref='form' formTitle='Sign up for beta' buttons={button}
        errorText={errContents} errorClassName={loginStyles.errors}
        onSubmitted={values => this.onSubmitted(values)} titleClassName={styles.signupTitle}>
      <ValidatedText label='Email address (required)' floatingLabel={true} name='email' tabIndex={1}
          autoCapitalize='off' autoCorrect='off' spellCheck={false}
          required={true} requiredMessage='Enter an email address'
          validator={emailValidator}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='TeamLiquid.net username' floatingLabel={true} name='teamliquidName'
          tabIndex={1} required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='Operating system version' floatingLabel={true} name='os' tabIndex={1}
          required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='Main browser' floatingLabel={true} name='browser' tabIndex={1}
          required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      <ValidatedText label='Graphics card' floatingLabel={true} name='graphics' tabIndex={1}
          required={false} autoCapitalize='off' autoCorrect='off' spellCheck={false}
          onEnterKeyDown={e => this.onSignUpClicked()}/>
      {/* TODO(2Pac): Make a radio component */}
      <ValidatedText label='Are you able to host games so far in BW?' floatingLabel={true}
          name='canHost' tabIndex={1} required={false} autoCapitalize='off' autoCorrect='off'
          spellCheck={false} onEnterKeyDown={e => this.onSignUpClicked()}/>
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
    if (canHost.toLowerCase()[0] === 'y') {
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
