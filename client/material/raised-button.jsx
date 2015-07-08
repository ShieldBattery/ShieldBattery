import React from 'react'
import classnames from 'classnames'
import Button from './button.jsx'

// A button that has elevation, and raises further when pressed
class RaisedButton extends React.Component {
  constructor(props) {
    super(props)
  }

  render() {
    let classes = classnames('raised-button', this.props.className, {
      primary: this.props.color != 'accent',
      accent: this.props.color == 'accent',
    })

    return (<Button {...this.props} className={classes}/>)
  }
}

RaisedButton.propTypes = Object.assign({}, Button.propTypes, {
  color: React.PropTypes.oneOf(['primary', 'accent']),
})

export default RaisedButton
