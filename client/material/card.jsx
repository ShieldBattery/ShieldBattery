let React = require('react')
  , { Paper } = require('material-ui')

let Card = React.createClass({
  render() {
    return (
      <Paper {...this.props} innerClassName='material-card'>
        { this.props.children }
      </Paper>
    )
  }
})

module.exports = Card
