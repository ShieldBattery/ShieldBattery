import React from 'react'
import { connect } from 'react-redux'
import styles from './beta.css'

import Card from '../material/card.jsx'
import RaisedButton from '../material/raised-button.jsx'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import TextField from '../material/text-field.jsx'
import {
  composeValidators,
  minLength,
  maxLength,
  regex,
  required,
} from '../forms/validators'
import {
  EMAIL_MINLENGTH,
  EMAIL_MAXLENGTH,
  EMAIL_PATTERN,
} from '../../app/common/constants'

import { createInvite } from './action-creators'


const emailValidator = composeValidators(
    required('Enter an email address'),
    minLength(EMAIL_MINLENGTH, `Use at least ${EMAIL_MINLENGTH} characters`),
    maxLength(EMAIL_MAXLENGTH, `Use at most ${EMAIL_MAXLENGTH} characters`),
    regex(EMAIL_PATTERN, 'Enter a valid email address')
)

@form({
  email: emailValidator,
})
class BetaSignupForm extends React.Component {
  render() {
    const { onSubmit, bindInput } = this.props
    const textInputProps = {
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
      tabIndex: 1,
    }

    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter/>
      <TextField {...bindInput('email')} inputProps={textInputProps}
          label='Email address (required)' floatingLabel={true}/>
      <TextField {...bindInput('teamliquidName')} inputProps={textInputProps}
          label='TeamLiquid.net username' floatingLabel={true}/>
      <TextField {...bindInput('os')} inputProps={textInputProps} label='Operating system version'
          floatingLabel={true}/>
      <TextField {...bindInput('browser')} inputProps={textInputProps} label='Main browser'
          floatingLabel={true}/>
      <TextField {...bindInput('graphics')} inputProps={textInputProps} label='Graphics card'
          floatingLabel={true}/>
      {/* TODO(2Pac): Make a radio component */}
      <TextField {...bindInput('canHost')} inputProps={textInputProps}
          label='Are you able to host games so far in BW?' floatingLabel={true}/>
    </form>)
  }
}

@connect()
export default class BetaSignup extends React.Component {
  state = {
    formSubmitted: false
  };
  _form = null;
  _setForm = elem => { this._form = elem };

  renderDoneMessage() {
    return (<div className={styles.signupDone}>
        <p className={styles.signupDoneParagraph}>
          Thank you for signing up for the ShieldBattery beta! You will be notified by email
          when you receive a beta invite.
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
    return (<div>
      <h3>Sign up for beta</h3>
      <BetaSignupForm ref={this._setForm} model={{}} onSubmit={this.onSubmit}/>
      <RaisedButton label='Sign up' onClick={this.onSignUpClick} tabIndex={1}/>
    </div>)
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

  onSignUpClick = () => {
    this._form.submit()
  };

  onSubmit = () => {
    this.setState({ formSubmitted: true })

    const values = this._form.getModel()
    const canHost = !!values.canHost && values.canHost.toLowerCase()[0] === 'y'

    this.props.dispatch(createInvite({
      email: values.email,
      teamliquidName: values.teamliquidName,
      os: values.os,
      browser: values.browser,
      graphics: values.graphics,
      canHost,
    }))
  };
}
