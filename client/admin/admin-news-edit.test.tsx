import { render } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { AdminNewsEdit } from './admin-news'

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }))

vi.mock('urql', async importOriginal => ({
  ...(await importOriginal<typeof import('urql')>()),
  useQuery,
}))

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  useQuery.mockReset().mockReturnValue([{ data: undefined, fetching: true, error: undefined }])
})

describe('AdminNewsEdit', () => {
  test('loads the post from the network so the editor never seeds from a partial cache result', () => {
    render(<AdminNewsEdit params={{ id: 'post-id' }} />)

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { id: 'post-id' },
        requestPolicy: 'network-only',
      }),
    )
  })
})
