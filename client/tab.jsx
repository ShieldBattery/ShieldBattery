let React = require('react')
  , { Link, State } = require('react-router')

// TODO(tec27): write a tabs component because the material-ui one is kinda bad
class Tab extends React.Component {
  render() {
    let isActive = this.context.router.isActive(this.props.route)

    return (
      <li className={isActive ? 'tab-active' : ''}>
        <Link to={this.props.route}>{this.props.label}</Link>
      </li>
    )
  }
}

Tab.contextTypes = {
  router: React.PropTypes.func
}

module.exports = Tab
