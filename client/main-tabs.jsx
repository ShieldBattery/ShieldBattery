let React = require('react')
  , { RouteHandler } = require('react-router')
  , Tab = require('./tab.jsx')



let MainTabs = React.createClass({
  render() {
    return (<div>
      <ul className="tabs">
        <Tab label="Games" route="games" />
        <Tab label="Replays" route="replays" />
      </ul>
      <RouteHandler />
    </div>)
  },
})

module.exports = MainTabs
