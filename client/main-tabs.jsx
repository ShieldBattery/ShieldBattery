let React = require('react')
  , { Link, RouteHandler, State } = require('react-router')

// TODO(tec27): write a tabs component because the material-ui one is kinda bad
let Tab = React.createClass({
  mixins: [ State ],

  render() {
    let isActive = this.isActive(this.props.route)

    return (
      <li className={isActive ? 'tab-active' : ''}>
        <Link to={this.props.route}>{this.props.label}</Link>
      </li>
    )
  },
})

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
