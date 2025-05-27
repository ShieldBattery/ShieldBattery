import React from 'react'
import { DevSection } from '../../debug/dev-section'
import { HealthChecksDev } from './health-checks-dev'

export function DevStarcraft() {
  return (
    <DevSection
      baseUrl='/dev/starcraft'
      routes={[['Health checks', 'health-checks', HealthChecksDev]]}
    />
  )
}
