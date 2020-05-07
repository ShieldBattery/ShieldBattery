import Redis from 'ioredis'

// TODO(tec27): provide some better wrapper around this that deals with connects/disconnects, etc.
export default new Redis({
  port: Number(process.env.SB_REDIS_PORT),
  host: process.env.SB_REDIS_HOST,
  dropBufferSupport: true,
})
