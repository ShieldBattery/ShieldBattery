import React from 'react'
import FontIcon from './font-icon.jsx'

class LeftNav extends React.Component {
  render() {
    return (<nav className="leftnav">
      <div className="logotext">
        <h3 className="logotext-light">Shield</h3>
        <h3 className="logotext-medium">Battery</h3>
      </div>
      <p className="leftnav-subheader body-2">Chat channels</p>
      <ul className="leftnav-section">
        <li className="leftnav-entry">#doyoureallywantthem</li>
        <li className="leftnav-entry active">#teamliquid</li>
        <li className="leftnav-entry">#x17</li>
        <li className="leftnav-entry">#nohunters</li>
        <li className="leftnav-entry">
          <FontIcon>add_circle</FontIcon>
          <span>Join another</span>
        </li>
      </ul>
      <hr className="leftnav-divider"></hr>
      <p className="leftnav-subheader">Whispers</p>
      <ul className="leftnav-section">
        <li className="leftnav-entry">Pachi</li>
      </ul>
    </nav>)
  }
}

export default LeftNav
