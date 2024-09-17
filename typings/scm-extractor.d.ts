declare module 'scm-extractor' {
  import { Transform } from 'node:stream'
  export default function createScmExtractor(): Transform
}
