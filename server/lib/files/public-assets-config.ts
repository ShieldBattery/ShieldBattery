import { container, instanceCachingFactory } from 'tsyringe'

export enum FileStoreType {
  FileSystem = 'filesystem',
  Spaces = 'doSpaces',
}

export class PublicAssetsConfig {
  private _type: FileStoreType
  private _origin: string
  private _path: string
  private _cdnHost?: string

  constructor(configJson: string, canonicalHost: string) {
    const config = JSON.parse(configJson)

    if (config.filesystem) {
      this._type = FileStoreType.FileSystem
      this._origin = canonicalHost.endsWith('/') ? canonicalHost.slice(0, -1) : canonicalHost
      this._path = '/'
    } else if (config.doSpaces) {
      this._type = FileStoreType.Spaces
      this._cdnHost = config.doSpaces.cdnHost ? `https://${config.doSpaces.cdnHost}` : undefined
      if (this._cdnHost?.endsWith('/')) {
        this._cdnHost = this._cdnHost.slice(0, -1)
      }
      this._origin =
        this._cdnHost ?? `https://${config.doSpaces.bucket}.${config.doSpaces.endpoint}`
      this._path = '/public/'
    } else {
      throw new Error('Invalid file store config: unrecognized type')
    }
  }

  get type() {
    return this._type
  }

  get usingCdn(): boolean {
    return !!this._cdnHost
  }

  get origin() {
    return this._origin
  }

  get publicAssetsUrl() {
    return `${this._origin}${this._path}`
  }
}

container.register(PublicAssetsConfig, {
  useFactory: instanceCachingFactory(
    () => new PublicAssetsConfig(process.env.SB_FILE_STORE!, process.env.SB_CANONICAL_HOST!),
  ),
})
