import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
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

import { verifyEmail, sendVerificationEmail } from './auther'
import { isLoggedIn, createNextPath } from './auth-utils'

@connect(state => ({ auth: state.auth }))
export class EmailVerification extends React.Component {
  static propTypes = {
    title: PropTypes.string.isRequired,
    doSubmit: PropTypes.func.isRequired,
    successMessage: PropTypes.string,
    location: PropTypes.object,
  }

  state = {
    reqId: null,
    success: false,
  }

  componentDidMount() {
    if (isLoggedIn(this.props.auth)) {
      const { id, action } = this.props.doSubmit()
      this.setState({
        reqId: id,
        success: false,
      })
      this.props.dispatch(action)
    }
  }

  componentWillUpdate(nextProps, nextState) {
    if (this.props.auth.authChangeInProgress && !nextProps.auth.authChangeInProgress) {
      if (this.state.reqId && !nextProps.auth.lastFailure) {
        this.setState({ success: true })
      }
    }
  }

  render() {
    const {
      auth,
      auth: { authChangeInProgress, lastFailure },
      title,
      successMessage,
    } = this.props
    const { reqId, success } = this.state

    let loadingContents
    if (authChangeInProgress) {
      loadingContents = (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    let contents
    let bottomActionButton
    if (!isLoggedIn(auth)) {
      contents = (
        <ErrorsContainer>
          Error: You need to be logged-in inorder to perform the email verification. Please log in
          by clicking the button below and try again.
        </ErrorsContainer>
      )
      bottomActionButton = <BottomActionButton label="Log in" onClick={this.onLogInClick} />
    } else if (reqId && lastFailure && lastFailure.reqId === reqId) {
      contents = <ErrorsContainer>Error: {lastFailure.err}</ErrorsContainer>

      // Until we add a proper error system, we're stuck with checks like these :/
      if (lastFailure.err.startsWith('The provided email or verification code is not valid.')) {
        bottomActionButton = (
          <BottomActionButton label="Resend verification email" onClick={this.onResendClick} />
        )
      }
    } else if (success && successMessage) {
      contents = <SuccessContainer>{successMessage}</SuccessContainer>

      // eslint-disable-next-line no-use-before-define
      if (successMessage === VERIFY_EMAIL_SUCCESS) {
        bottomActionButton = <BottomActionButton label="Continue" onClick={this.onContinueClick} />
      }
    } else {
      contents = <ErrorsContainer>Something went terribly wrong. Please try again.</ErrorsContainer>
    }

    return (
      <AuthContent>
        <AuthContentContainer isLoading={authChangeInProgress}>
          <AuthTitle>{title}</AuthTitle>
          <AuthBody>{contents}</AuthBody>
          <AuthBottomAction>{bottomActionButton}</AuthBottomAction>
        </AuthContentContainer>
        {loadingContents}
      </AuthContent>
    )
  }

  onContinueClick = () => {
    this.props.dispatch(routerActions.push({ pathname: '/' }))
  }

  onResendClick = () => {
    const { userId, email } = queryString.parse(this.props.location.search)
    const search = queryString.stringify({ userId, email })
    this.props.dispatch(routerActions.push({ pathname: '/send-verification-email', search }))
  }

  onLogInClick = () => {
    const search = createNextPath(this.props.location)
    this.props.dispatch(routerActions.push({ pathname: '/login', search }))
  }
}

const VERIFY_EMAIL_SUCCESS = 'Your email has been successfully verified.'
export const VerifyEmail = ({ location }) => {
  const { userId, token, email } = queryString.parse(location.search)
  return (
    <EmailVerification
      title={'Verify email'}
      doSubmit={() => verifyEmail(userId, token, email)}
      successMessage={VERIFY_EMAIL_SUCCESS}
      location={location}
    />
  )
}

const SEND_VERIFICATION_EMAIL_SUCCESS =
  'Verification email has successfully been sent. Check your email.'
export const SendVerificationEmail = ({ location }) => {
  const { userId, email } = queryString.parse(location.search)
  return (
    <EmailVerification
      title={'Send verification email'}
      doSubmit={() => sendVerificationEmail(userId, email)}
      successMessage={SEND_VERIFICATION_EMAIL_SUCCESS}
      location={location}
    />
  )
}
