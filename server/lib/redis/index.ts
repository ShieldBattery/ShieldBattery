import IoRedis from 'ioredis'
import { singleton } from 'tsyringe'

// TODO(tec27): provide some better wrapper around this that deals with connects/disconnects, etc.
@singleton()
export class Redis extends IoRedis {
  constructor() {
    super({
      port: Number(process.env.SB_REDIS_PORT),
      host: process.env.SB_REDIS_HOST,
      dropBufferSupport: true,
    })
  }
}
