import React from 'react'
import { DevSection } from '../../debug/dev-section'
import { GameCounterDev } from './game-counter-dev'

export function DevHome() {
  return (
    <DevSection baseUrl='/dev/home' routes={[['Game counter', 'game-counter', GameCounterDev]]} />
  )
}
