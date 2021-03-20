import React from 'react'
import { useLocation } from 'wouter'

import { AppBarTitle } from '../app-bar/app-bar'

export default function AdminTitle() {
  const [location] = useLocation()

  let appBarTitle
  if (location === '/admin') {
    appBarTitle = 'Admin panel'
  } else if (location.startsWith('/admin/users')) {
    appBarTitle = 'Users'
  } else if (location.startsWith('/admin/invites')) {
    appBarTitle = 'Invites'
  } else if (location.startsWith('/admin/patch-upload')) {
    appBarTitle = 'Upload StarCraft patch'
  } else if (location.startsWith('/admin/map-upload')) {
    appBarTitle = 'Map upload'
  }

  return <AppBarTitle>{appBarTitle}</AppBarTitle>
}
