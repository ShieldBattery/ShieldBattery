let React = require('react')
  , Card = require('./material/card.jsx')

let Home = React.createClass({
  render() {
    return (
      <Card zDepth={1}>
        <h3>Welcome home.</h3>
        <p>Testing a raised card.</p>
      </Card>
    )
  }
})

module.exports = Home
