// TODO(tec27): Make proper types for jssuh (and include them in the module ideally)
declare module 'jssuh' {
  import { Transform } from 'stream'

  export default class ReplayParser extends Transform {}
}
