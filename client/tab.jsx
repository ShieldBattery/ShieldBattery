let React = require('react')
  , { Link, State } = require('react-router')

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

module.exports = Tab
