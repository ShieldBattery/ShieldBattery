import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'

// The dialog is as wide as the image (up to the viewport) rather than the default fixed width, and
// the image is only scaled down as far as it takes to fit what is left of the viewport.
const StyledDialog = styled(Dialog)`
  width: auto;
  max-width: calc(100% - 80px);
  max-height: calc(100% - 80px);
`

const FullImage = styled.img`
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 280px);
  margin: 0 auto;
`

export interface ImageViewerDialogProps extends CommonDialogProps {
  src: string
  alt?: string
  caption?: string
  returnFocusId?: string
}

export function ImageViewerDialog({
  src,
  alt,
  caption,
  returnFocusId,
  onCancel,
}: ImageViewerDialogProps) {
  const { t } = useTranslation()

  // The dialog system moves focus into the dialog when it opens and leaves it there when it
  // closes, so the element that opened the viewer is looked up and focused again on the way out.
  useEffect(() => {
    return () => {
      if (returnFocusId) {
        document.getElementById(returnFocusId)?.focus()
      }
    }
  }, [returnFocusId])

  return (
    <StyledDialog
      title={caption || alt || t('markdown.imageViewer.title', 'Image')}
      showCloseButton={true}
      onCancel={onCancel}
      buttons={[
        <TextButton
          key='open'
          label={t('markdown.imageViewer.openInBrowser', 'Open in browser')}
          onClick={() => window.open(src, '_blank', 'noopener')}
        />,
      ]}>
      <FullImage src={src} alt={alt ?? ''} />
    </StyledDialog>
  )
}
