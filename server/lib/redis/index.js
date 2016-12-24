import Redis from 'ioredis'
import config from '../../config'

// TODO(tec27): provide some better wrapper around this that deals with connects/disconnects, etc.
export default new Redis({
  port: config.redis.port,
  host: config.redis.host,
  dropBufferSupport: true,
})
