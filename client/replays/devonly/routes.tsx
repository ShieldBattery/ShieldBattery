import { DevSection } from '../../debug/dev-section'
import { IndexingProgressTest } from './indexing-progress-test'

export function DevReplays() {
  return (
    <DevSection
      baseUrl='/dev/replays'
      routes={[['Indexing progress', 'indexing-progress', IndexingProgressTest]]}
    />
  )
}
