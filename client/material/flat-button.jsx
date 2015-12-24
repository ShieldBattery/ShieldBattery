import React from 'react'
import classnames from 'classnames'
import Button from './button.jsx'
import styles from './button.css'

// A button with no elevation
class FlatButton extends React.Component {
  render() {
    const classes = classnames(styles.flat, this.props.className, {
      [styles.primary]: this.props.color === 'primary',
      [styles.accent]: this.props.color === 'accent',
    })

    return (<Button {...this.props} className={classes}/>)
  }
}

FlatButton.propTypes = Object.assign({}, Button.propTypes, {
  color: React.PropTypes.oneOf(['primary', 'accent', 'normal']),
})

export default FlatButton
