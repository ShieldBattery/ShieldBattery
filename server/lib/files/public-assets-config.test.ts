import { FileStoreType, PublicAssetsConfig } from './public-assets-config'

describe('publicAssetsConfig', () => {
  test('filesystem', () => {
    const config = new PublicAssetsConfig(
      '{"filesystem":{"path":"server/uploaded_files"}}',
      'https://example.org',
    )

    expect(config.type).toBe(FileStoreType.FileSystem)
    expect(config.origin).toBe('https://example.org')
    expect(config.publicAssetsUrl).toBe('https://example.org/')
    expect(config.usingCdn).toBe(false)
  })

  test('doSpaces - CDN', () => {
    const config = new PublicAssetsConfig(
      `
      {"doSpaces":
        {
          "endpoint":"region.digitaloceanspaces.com",
          "accessKeyId":"ACCESS_KEY_ID",
          "secretAccessKey":"SUPER_SECRET_ACCESS_KEY",
          "bucket":"example-bucket",
          "cdnHost":"cdn.example.org"
        }
      }`,
      'https://example.org',
    )

    expect(config.type).toBe(FileStoreType.Spaces)
    expect(config.origin).toBe('https://cdn.example.org')
    expect(config.publicAssetsUrl).toBe('https://cdn.example.org/public/')
    expect(config.usingCdn).toBe(true)
  })

  test('doSpaces - no CDN', () => {
    const config = new PublicAssetsConfig(
      `
      {"doSpaces":
        {
          "endpoint":"region.digitaloceanspaces.com",
          "accessKeyId":"ACCESS_KEY_ID",
          "secretAccessKey":"SUPER_SECRET_ACCESS_KEY",
          "bucket":"example-bucket"
        }
      }`,
      'https://example.org',
    )

    expect(config.type).toBe(FileStoreType.Spaces)
    expect(config.origin).toBe('https://example-bucket.region.digitaloceanspaces.com')
    expect(config.publicAssetsUrl).toBe(
      'https://example-bucket.region.digitaloceanspaces.com/public/',
    )
    expect(config.usingCdn).toBe(false)
  })
})
