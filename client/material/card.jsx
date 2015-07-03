let React = require('react')
  , { Paper } = require('material-ui')

let Card = React.createClass({
  render() {
    return (
      <div className='card shadow-1'>
        { this.props.children }
      </div>
    )
  }
})

module.exports = Card
