let React = require('react')
  , Router = require('react-router')
  , App = require('./app.jsx')
  , AppNotFound = require('./app-not-found.jsx')
  , MainNav = require('./main-nav.jsx')
  , Home = require('./home.jsx')
  , Games = require('./games/games.jsx')
  , Replays = require('./replays/replays.jsx')
  , LoginRequired = require('./auth/login-required.jsx')
  , Login = require('./auth/login.jsx')
  , Signup = require('./auth/signup.jsx')

let { DefaultRoute, NotFoundRoute, Route } = Router

let Routes = (
  <Route path="/" handler={App}>
    <Route handler={LoginRequired}>
      <Route handler={MainNav}>
        <DefaultRoute name="home" handler={Home} />
        <Route name="games" handler={Games} />
        <Route name="replays" handler={Replays} />
      </Route>
    </Route>
    <Route name="login" handler={Login} />
    <Route name="signup" handler={Signup} />
    <NotFoundRoute handler={AppNotFound} />
  </Route>
)

module.exports = Routes
