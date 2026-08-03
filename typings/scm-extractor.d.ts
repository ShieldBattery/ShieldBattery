// scm-extractor ships no types of its own. It's a factory for a Transform stream that pipes
// through the raw bytes of an SC:R map file (.scm/.scx) and emits the extracted `scenario.chk`
// contents, handling both plain SCM files and password-protected/"protected" map archives.
declare module 'scm-extractor' {
  import { Transform } from 'stream'

  export default function scmExtractor(): Transform
}
