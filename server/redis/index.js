import redis from 'redis'
import config from '../../config'

// TODO(tec27): provide some better wrapper around this that deals with connects/disconnects, etc.
export default redis.createClient(config.redis.port, config.redis.host)
