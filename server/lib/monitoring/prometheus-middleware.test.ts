import { register } from 'prom-client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { getDbPoolStats } from '../db'
import { prometheusMiddleware } from './prometheus-middleware'

vi.mock('../db', () => ({
  getDbPoolStats: vi.fn(),
}))

beforeEach(() => {
  register.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  register.clear()
})

test('reports the current PostgreSQL pool state', async () => {
  asMockedFunction(getDbPoolStats).mockReturnValue({
    totalConnections: 10,
    idleConnections: 4,
    inUseConnections: 6,
    waitingRequests: 2,
    maxConnections: 10,
  })

  prometheusMiddleware()

  const connections = await register.getSingleMetricAsString('database_pool_connections')
  expect(connections).toContain('database_pool_connections{state="total"} 10')
  expect(connections).toContain('database_pool_connections{state="idle"} 4')
  expect(connections).toContain('database_pool_connections{state="in_use"} 6')

  await expect(
    register.getSingleMetricAsString('database_pool_max_connections'),
  ).resolves.toContain('database_pool_max_connections 10')
  await expect(
    register.getSingleMetricAsString('database_pool_waiting_requests'),
  ).resolves.toContain('database_pool_waiting_requests 2')
})
