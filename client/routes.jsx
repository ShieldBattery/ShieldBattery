let React = require('react')
  , Router = require('react-router')
  , App = require('./app.jsx')
  , AppNotFound = require('./app-not-found.jsx')
  , MainTabs = require('./main-tabs.jsx')
  , Home = require('./home.jsx')
  , Games = require('./games/games.jsx')
  , Replays = require('./replays/replays.jsx')

let { DefaultRoute, NotFoundRoute, Route } = Router

let Routes = (
  <Route path="/" handler={App}>
    <Route handler={MainTabs}>
      <DefaultRoute name="home" handler={Home} />
      <Route name="games" handler={Games} />
      <Route name="replays" handler={Replays} />
    </Route>
    <NotFoundRoute handler={AppNotFound} />
  </Route>
)

module.exports = Routes
