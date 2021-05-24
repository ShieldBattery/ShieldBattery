import React from 'react'
import { DevSection } from '../../debug/dev-section'
import { ProfilePageTest } from './page-test'

export function DevProfile() {
  return <DevSection baseUrl={'/dev/profile'} routes={[['Page', 'page', ProfilePageTest]]} />
}
