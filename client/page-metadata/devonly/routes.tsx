import { DevSection } from '../../debug/dev-section'
import { LinkPreviewTest } from './link-preview-test'

export function DevPageMetadata() {
  return (
    <DevSection
      baseUrl='/dev/page-metadata'
      routes={[['Link previews', 'link-previews', LinkPreviewTest]]}
    />
  )
}
