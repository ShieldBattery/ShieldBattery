let React = require('react')
  , { Paper } = require('material-ui')

let Card = React.createClass({
  render() {
    return (
      <Paper zDepth={this.props.zDepth} innerClassName='material-card'>
        { this.props.children }
      </Paper>
    )
  }
})

module.exports = Card
