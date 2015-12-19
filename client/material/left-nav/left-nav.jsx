import React from 'react'
import Divider from './divider.jsx'
import Entry from './entry.jsx'
import FontIcon from '../font-icon.jsx'
import Section from './section.jsx'
import Subheader from './subheader.jsx'

class LeftNav extends React.Component {
  render() {
    return (<nav className='leftnav'>
      <div className='logotext'>
        <h3 className='logotext-light'>Shield</h3>
        <h3 className='logotext-medium'>Battery</h3>
      </div>
      <Subheader>Chat channels</Subheader>
      <Section>
        <Entry>#doyoureallywantthem</Entry>
        <Entry active={true}>#teamliquid</Entry>
        <Entry>#x17</Entry>
        <Entry>#nohunters</Entry>
        <Entry>
          <FontIcon>add_circle</FontIcon>
          <span>Join another</span>
        </Entry>
      </Section>
      <Divider/>
      <Subheader>Whispers</Subheader>
      <Section>
        <Entry>Pachi</Entry>
      </Section>
    </nav>)
  }
}

export default LeftNav
