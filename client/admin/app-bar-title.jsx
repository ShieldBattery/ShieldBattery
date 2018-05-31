import React from 'react'
import { connect } from 'react-redux'

import { AppBarTitle } from '../app-bar/app-bar.jsx'

@connect(state => ({ routing: state.routing }))
export default class AdminTitle extends React.Component {
  render() {
    const {
      routing: {
        location: { pathname },
      },
    } = this.props

    let appBarTitle
    if (pathname === '/admin') {
      appBarTitle = 'Admin panel'
    } else if (pathname.startsWith('/admin/users')) {
      appBarTitle = 'Users'
    } else if (pathname.startsWith('/admin/invites')) {
      appBarTitle = 'Invites'
    } else if (pathname.startsWith('/admin/patch-upload')) {
      appBarTitle = 'Upload StarCraft patch'
    } else if (pathname.startsWith('/admin/map-upload')) {
      appBarTitle = 'Map upload'
    }

    return <AppBarTitle>{appBarTitle}</AppBarTitle>
  }
}
