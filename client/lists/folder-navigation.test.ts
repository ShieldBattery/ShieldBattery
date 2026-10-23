import { describe, expect, test } from 'vitest'
import { crumbsForPath } from './folder-navigation'

describe('client/lists/folder-navigation/crumbsForPath', () => {
  const label = (path: string, name: string) => (path === 'documents' ? 'Documents' : name)

  test('starts at the top level', () => {
    expect(crumbsForPath(undefined, 'Map folders', label)).toEqual([
      { path: undefined, label: 'Map folders' },
    ])
  })

  test('steps down through each folder', () => {
    expect(crumbsForPath('documents/Download/UMS', 'Map folders', label)).toEqual([
      { path: undefined, label: 'Map folders' },
      { path: 'documents', label: 'Documents' },
      { path: 'documents/Download', label: 'Download' },
      { path: 'documents/Download/UMS', label: 'UMS' },
    ])
  })
})
