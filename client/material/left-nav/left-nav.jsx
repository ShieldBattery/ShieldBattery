import React from 'react'

export default function LeftNav(props) {
  return (<nav className='leftnav'>
    <div className='logotext'>
      <h3 className='logotext-light'>Shield</h3>
      <h3 className='logotext-medium'>Battery</h3>
    </div>
    {props.children}
  </nav>)
}
