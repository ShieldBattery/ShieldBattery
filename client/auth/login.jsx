let React = require('react')
  , Card = require('../material/card.jsx')
  , { Checkbox, TextField, RaisedButton, FlatButton } = require('material-ui')
  , authStore = require('./auth-store')
  , auther = require('./auther')

class Login extends React.Component {
  constructor() {
    super()
    this.authStoreListener = () => this.onAuthChange()
    this.state = {
      authChangeInProgress: false,
      reqId: null,
      failure: null,
      notSubmitted: true,
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
        errContents = <span>{`Error: ${this.state.failure.error}`}</span>
      }

      cardContents = <form>
        <div className="fields">
          <h3>Log in</h3>
          { errContents }
          <div>
            <TextField floatingLabelText="Username" onEnterKeyDown={e => this.onLogInClicked()}
                tabIndex={1} ref="username"
                onChange={e => this.validate(this.state.notSubmitted && 'username')}
                errorText={this.state.formErrors && this.state.formErrors.get('username')}/>
          </div>
          <div>
            <TextField floatingLabelText="Password" onEnterKeyDown={e => this.onLogInClicked()}
                tabIndex={1} type="password" ref="password"
                onChange={e => this.validate(this.state.notSubmitted && 'password')}
                errorText={this.state.formErrors && this.state.formErrors.get('password')}/>
          </div>
          <Checkbox name="remember" label="Remember me" tabIndex={1}
              ref="remember"/>
        </div>
        <div className="button-area">
          <FlatButton type="button" label="Sign up" secondary={true}
              onTouchTap={e => this.onSignUpClicked(e)} tabIndex={2}/>
          <FlatButton type ="button" label="Log in" primary={true}
              onTouchTap={e => this.onLogInClicked(e)} tabIndex={1}/>
        </div>
      </form>
    }

    return <Card zDepth={1} className="card-form">{cardContents}</Card>
  }

  onSignUpClicked() {
    this.context.router.transitionTo('signup', null,
        Object.assign(this.context.router.getCurrentQuery(), {
          username: this.refs.username.getValue()
        }))
  }

  validate(dirtyElem) {
    let username = this.refs.username.getValue()
      , password = this.refs.password.getValue()
      , remember = this.refs.remember.isChecked()
      , formErrors = new Map()
    if (!username && (!dirtyElem || dirtyElem == 'username')) {
      formErrors.set('username', 'Enter a username')
    }
    if (!password && (!dirtyElem || dirtyElem == 'password')) {
      formErrors.set('password', 'Enter a password')
    }

    if (formErrors.size) {
      this.setState({
        formErrors
      })
      return formErrors
    } else {
      this.setState({
        formErrors: null
      })
      return null
    }
  }

  onLogInClicked() {
    this.setState({
      notSubmitted: false
    })
    let formErrors = this.validate()
    if (formErrors) {
      this.refs[formErrors.keys().next().value].focus()
      return
    }

    let username = this.refs.username.getValue()
      , password = this.refs.password.getValue()
      , remember = this.refs.remember.isChecked()
    let id = auther.logIn(username, password, remember)
    this.setState({
      reqId: id
    })
  }
}

Login.contextTypes = {
  router: React.PropTypes.func
}

module.exports = Login
