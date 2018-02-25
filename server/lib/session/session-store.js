import redisStore from 'koa-redis'
import redis from '../redis'

export default redisStore({ client: redis })
