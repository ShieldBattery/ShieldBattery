import React from 'react'
import classnames from 'classnames'
import Button from './button.jsx'

// A button with no elevation
class FlatButton extends React.Component {
  render() {
    const classes = classnames('flat-button', this.props.className, {
      primary: this.props.color === 'primary',
      accent: this.props.color === 'accent',
    })

    return (<Button {...this.props} className={classes}/>)
  }
}

FlatButton.propTypes = Object.assign({}, Button.propTypes, {
  color: React.PropTypes.oneOf(['primary', 'accent', 'normal']),
})

export default FlatButton
