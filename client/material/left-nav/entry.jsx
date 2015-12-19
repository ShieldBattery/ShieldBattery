import React from 'react'

const Entry = (props) => {
  const classes = 'leftnav-entry' + (props.active ? ' active' : '')
  return <li className={classes}>{props.children}</li>
}
Entry.propTypes = {
  active: React.PropTypes.bool,
}

export default Entry
