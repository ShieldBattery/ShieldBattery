import React from 'react'
import classnames from 'classnames'
import Button from './button.jsx'
import styles from './button.css'

// A button that has elevation, and raises further when pressed
class RaisedButton extends React.Component {
  constructor(props) {
    super(props)
  }

  render() {
    const classes = classnames(styles.raised, this.props.className, {
      [styles.primary]: this.props.color !== 'accent',
      [styles.accent]: this.props.color === 'accent',
    })

    return (<Button {...this.props} className={classes}/>)
  }
}

RaisedButton.propTypes = Object.assign({}, Button.propTypes, {
  color: React.PropTypes.oneOf(['primary', 'accent']),
})

export default RaisedButton
