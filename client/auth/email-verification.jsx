import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import fetch from '../network/fetch'
import queryString from 'query-string'

import {
  AuthContentContainer,
  AuthContent,
  AuthTitle,
  AuthBody,
  LoadingArea,
  ErrorsContainer,
  SuccessContainer,
  AuthBottomAction,
  BottomActionButton,
} from './auth-content.jsx'
import LoadingIndicator from '../progress/dots.jsx'

import { isLoggedIn } from './auth-utils'
import { AUTH_UPDATE_EMAIL_VERIFIED } from '../actions'

@connect(state => ({ auth: state.auth }))
export class EmailVerification extends React.Component {
  state = {
    isRequesting: false,
    emailVerificationError: null,
    emailSentError: null,
    emailVerified: false,
    verificationEmailSent: false,
  }

  componentDidMount() {
    const { auth, location } = this.props
    const { sendEmail } = queryString.parse(location.search)

    if (!isLoggedIn(auth)) return

    if (sendEmail) {
      this.requestBegin(this.sendEmail)
    } else {
      this.requestBegin(this.verifyEmail)
    }
  }

  render() {
    const { auth } = this.props
    const {
      isRequesting,
      emailVerificationError,
      emailSentError,
      emailVerified,
      verificationEmailSent,
    } = this.state

    let loadingContents
    if (isRequesting) {
      loadingContents = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    let contents
    if (!isLoggedIn(auth)) {
      contents = (
        <ErrorsContainer>
          Error: You need to be logged-in inorder to verify your email. Please log in by clicking
          the button below and try again.
        </ErrorsContainer>
      )
    } else if (emailVerificationError) {
      contents = <ErrorsContainer>Error: {emailVerificationError}</ErrorsContainer>
    } else if (emailSentError) {
      contents = <ErrorsContainer>Error: {emailSentError}</ErrorsContainer>
    } else if (emailVerified) {
      contents = <SuccessContainer>Your email has been successfully verified.</SuccessContainer>
    } else if (verificationEmailSent) {
      contents = (
        <SuccessContainer>
          Verification email has successfully been sent. Check your email.
        </SuccessContainer>
      )
    }

    let bottomActionButton
    if (!isLoggedIn(auth)) {
      bottomActionButton = (
        <BottomActionButton label="Log in" onClick={this.onLogInClick} tabIndex={1} />
      )
    } else if (emailVerified) {
      bottomActionButton = (
        <BottomActionButton label="Continue" onClick={this.onContinueClick} tabIndex={1} />
      )
    } else if (emailVerificationError && emailVerificationError.startsWith('The provided email')) {
      bottomActionButton = (
        <BottomActionButton
          label="Resend verification email"
          onClick={() => this.requestBegin(this.sendEmail)}
          tabIndex={1}
        />
      )
    }

    return (
      <AuthContent>
        <AuthContentContainer isLoading={isRequesting}>
          <AuthTitle>Email verification</AuthTitle>
          <AuthBody>{contents}</AuthBody>
        </AuthContentContainer>
        {loadingContents}
        <AuthBottomAction>{bottomActionButton}</AuthBottomAction>
      </AuthContent>
    )
  }

  baseUrl = () => {
    const { user: { id } } = this.props.auth

    return `/api/1/users/${encodeURIComponent(id)}`
  }

  requestBegin = callback => {
    this.setState({ isRequesting: true }, callback)
  }

  verifyEmail = async () => {
    const { user: { email } } = this.props.auth
    const { token } = queryString.parse(this.props.location.search)

    try {
      await fetch(`${this.baseUrl()}/emailVerification?code=${encodeURIComponent(token)}`, {
        method: 'post',
        body: JSON.stringify({ email }),
      })

      this.setState({
        isRequesting: false,
        emailVerified: true,
      })

      // Annoyingly, our site socket is not connected at this point so it will not receive the
      // original event from the server meant to update our store, so we do it half-manually here.
      this.props.dispatch({ type: AUTH_UPDATE_EMAIL_VERIFIED })
    } catch (err) {
      const { body, res } = err
      let errMessage = body ? body.error : 'Verification error'
      if (res.status === 400) {
        errMessage = `The provided email or verification code is not valid. If the verification code
          matches the one you were emailed, it may have expired. Please request a new verification
          email and try again.`
      }

      this.setState({
        isRequesting: false,
        emailVerificationError: errMessage,
      })
    }
  }

  sendEmail = async () => {
    const { user: { email } } = this.props.auth

    try {
      await fetch(`${this.baseUrl()}/sendVerification`, {
        method: 'post',
        body: JSON.stringify({ email }),
      })

      this.setState({
        isRequesting: false,
        verificationEmailSent: true,
        emailVerificationError: null,
      })
    } catch (err) {
      const { body, res } = err
      let errMessage = body ? body.error : 'Sending verification error'
      if (res.status === 409) {
        errMessage = `The provided email is over verification limit. Please specify a different
          email address.`
      }

      this.setState({
        isRequesting: false,
        emailVerificationError: null,
        emailSentError: errMessage,
      })
    }
  }

  onContinueClick = () => {
    this.props.dispatch(routerActions.push({ pathname: '/' }))
  }

  onLogInClick = () => {
    const { pathname, search } = this.props.location
    const nextPath = '?nextPath=' + pathname + search
    this.props.dispatch(routerActions.push({ pathname: '/login', search: nextPath }))
  }
}
