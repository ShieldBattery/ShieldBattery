let React = require('react')
  , { RouteHandler } = require('react-router')
  , authStore = require('./auth-store')

class LoginRequired extends React.Component {
  constructor() {
    super()
    this.onAuthChange = () => this.ensureLoggedIn()
  }

  static willTransitionTo(transition) {
    if (!authStore.isLoggedIn) {
      transition.redirect('login', {}, { nextPath: transition.path })
    }
  }

  ensureLoggedIn() {
    if (!authStore.isLoggedIn) {
      this.context.router.transitionTo('login', {}, {
        nextPath: this.context.router.getCurrentPath()
      })
    }
  }

  componentDidMount() {
    authStore.register(this.onAuthChange)
  }

  componentWillUnmount() {
    authStore.unregister(this.onAuthChange)
  }

  render() {
    return <RouteHandler {...this.props} />
  }
}

LoginRequired.contextTypes = {
  router: React.PropTypes.func
}

module.exports = LoginRequired
