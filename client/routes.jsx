let React = require('react')
  , Router = require('react-router')
  , App = require('./app.jsx')
  , AppNotFound = require('./app-not-found.jsx')
  , MainTabs = require('./main-tabs.jsx')
  , Home = require('./home.jsx')
  , Games = require('./games/games.jsx')
  , Replays = require('./replays/replays.jsx')
  , LoginRequired = require('./auth/login-required.jsx')
  , Login = require('./auth/login.jsx')
  , Signup = require('./auth/signup.jsx')

let { DefaultRoute, NotFoundRoute, Route } = Router

let Routes = (
  <Route path="/" handler={App}>
    <Route handler={MainTabs}>
      <Route handler={LoginRequired}>
        <DefaultRoute name="home" handler={Home} />
        <Route name="games" handler={Games} />
        <Route name="replays" handler={Replays} />
      </Route>
      <Route name="login" handler={Login} />
      <Route name="signup" handler={Signup} />
    </Route>
    <NotFoundRoute handler={AppNotFound} />
  </Route>
)

module.exports = Routes
