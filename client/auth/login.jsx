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
    if (this.checkLoggedIn) return 

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
                tabIndex={1} ref="username"/>
          </div>
          <div>
            <TextField floatingLabelText="Password" onEnterKeyDown={e => this.onLogInClicked()}
                tabIndex={1} ref="password"/>
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
    this.context.router.transitionTo('signup')
  }

  onLogInClicked() {
    let username = this.refs.username.getValue()
      , password = this.refs.password.getValue()
      , remember = this.refs.remember.isChecked()
    if (!username || !password) {
      // FIXME
      console.log('fuck!')
      return
    }

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
