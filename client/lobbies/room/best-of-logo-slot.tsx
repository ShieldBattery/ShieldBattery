import { ChangeEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BEST_OF_LOGO_ACCEPTED_TYPES } from '../../../common/lobbies/lobby-best-of'
import { useObjectUrl } from '../../dom/use-object-url'
import { MaterialIcon } from '../../icons/material/material-icon'
import { OutlinedButton, TextButton } from '../../material/button'
import { EllipsizedText } from '../../material/ellipsized-text'
import { DotsIndicator } from '../../progress/dots'
import { bodyMedium, bodySmall } from '../../styles/typography'
import {
  BEST_OF_LOGO_MAX_SIZE_MB,
  checkLogoFile,
  logoFileProblemMessage,
  LogoSlotValue,
} from './series-setup'

const Root = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SlotRow = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 16px;
`

/**
 * Sized for a logo the overlay draws at up to 144×36: a wide wordmark fills its width, a square
 * emblem its height.
 */
const ThumbnailBox = styled.div`
  width: 160px;
  height: 56px;
  padding: 8px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  /* A mid-grey checkerboard, the usual sign of transparency, against which both light and dark
     artwork stays visible. */
  background-color: var(--color-grey50);
  background-image: conic-gradient(
    var(--color-grey60) 0 25%,
    transparent 0 50%,
    var(--color-grey60) 0 75%,
    transparent 0
  );
  background-size: 16px 16px;
`

const Thumbnail = styled.img`
  width: 100%;
  height: 100%;
  object-fit: contain;
`

const PlaceholderBox = styled.div`
  width: 160px;
  height: 56px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px dashed var(--theme-outline);
  border-radius: 4px;
  color: var(--theme-on-surface-variant);
`

const SlotInfo = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
`

/**
 * Stretched across the column, since the tooltip wrapper would otherwise take the column's start
 * alignment and grow to the full width of a long name instead of cutting it off.
 */
const FileName = styled(EllipsizedText)`
  ${bodyMedium};
  display: block;
  align-self: stretch;
`

const NoLogoText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const SlotActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  /* Cancels the first text button's start padding so its label lines up with the text above. */
  margin-left: -12px;
`

const Hint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodySmall};
  display: flex;
  align-items: flex-start;
  gap: 4px;

  color: var(--theme-error);
`

const ErrorIcon = styled(MaterialIcon)`
  flex-shrink: 0;
`

const HiddenFileInput = styled.input`
  display: none;
`

/**
 * The caster overlay's logo slot: the logo fitted in a box over a transparency checkerboard, the
 * name of the file it came from, and the buttons to change or remove it, or a placeholder and a
 * button to choose one. A picked file is checked here, before anything is sent, and one the server
 * wouldn't take is refused with the reason instead of being handed on.
 */
export function BestOfLogoSlot({
  value,
  loading = false,
  disabled = false,
  error,
  onPick,
  onRefuse,
  onRemove,
}: {
  value: LogoSlotValue
  /** Whether the logo the slot opens with is still being loaded. */
  loading?: boolean
  disabled?: boolean
  /** Why the last file picked, or the last upload, was refused. */
  error?: string
  /** Called with a picked file that passed the local checks. */
  onPick: (file: File) => void
  /** Called with the reason a picked file was refused. */
  onRefuse: (message: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  // Only the latest pick may land: a slow check of an earlier file must not overwrite it.
  const pickCountRef = useRef(0)
  const pickedUrl = useObjectUrl(value.kind === 'picked' ? value.file : undefined)

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so choosing the same file again still fires a change event.
    event.target.value = ''
    if (!file) {
      return
    }

    pickCountRef.current += 1
    const pickCount = pickCountRef.current
    checkLogoFile(file)
      .then(problem => {
        if (pickCount !== pickCountRef.current) {
          return
        }
        if (problem) {
          onRefuse(logoFileProblemMessage(problem, t))
        } else {
          onPick(file)
        }
      })
      .catch(() => {
        if (pickCount === pickCountRef.current) {
          onRefuse(logoFileProblemMessage({ kind: 'unreadable' }, t))
        }
      })
  }

  const chooseFile = () => inputRef.current?.click()

  let imageUrl: string | undefined
  let fileName: string | undefined
  if (value.kind === 'stored') {
    imageUrl = value.logo.url
    fileName = value.logo.fileName
  } else if (value.kind === 'picked') {
    imageUrl = pickedUrl
    fileName = value.file.name
  }
  const hasLogo = value.kind === 'stored' || value.kind === 'picked'

  let box: React.ReactNode
  if (loading) {
    box = (
      <PlaceholderBox>
        <DotsIndicator />
      </PlaceholderBox>
    )
  } else if (hasLogo) {
    box = (
      <ThumbnailBox>
        {/* An SVG is only ever shown through an <img>, which runs no script it carries. */}
        {imageUrl ? (
          <Thumbnail
            src={imageUrl}
            alt={t('lobbies.seriesSetup.logoAlt', 'Logo')}
            data-testid='series-setup-logo-image'
          />
        ) : null}
      </ThumbnailBox>
    )
  } else {
    box = (
      <PlaceholderBox>
        <MaterialIcon icon='image' size={24} />
      </PlaceholderBox>
    )
  }

  let info: React.ReactNode
  if (hasLogo) {
    info = (
      <>
        <FileName text={fileName ?? ''} />
        <SlotActions>
          <TextButton
            label={t('lobbies.seriesSetup.logoChange', 'Change')}
            disabled={disabled}
            onClick={chooseFile}
            testName='series-setup-logo-change'
          />
          <TextButton
            label={t('lobbies.seriesSetup.logoRemove', 'Remove')}
            disabled={disabled}
            onClick={onRemove}
            testName='series-setup-logo-remove'
          />
        </SlotActions>
      </>
    )
  } else {
    info = (
      <>
        {loading ? null : (
          <NoLogoText>
            {value.kind === 'unknown'
              ? t('lobbies.seriesSetup.logoUnknown', "Your last logo couldn't be loaded")
              : t('lobbies.seriesSetup.noLogo', 'No logo')}
          </NoLogoText>
        )}
        <OutlinedButton
          label={t('lobbies.seriesSetup.logoChoose', 'Choose image')}
          iconStart='add_photo_alternate'
          disabled={disabled || loading}
          onClick={chooseFile}
          testName='series-setup-logo-choose'
        />
      </>
    )
  }

  return (
    <Root role='group' aria-label={t('lobbies.seriesSetup.logoLabel', 'Logo')}>
      <HiddenFileInput
        ref={inputRef}
        type='file'
        accept={BEST_OF_LOGO_ACCEPTED_TYPES.join(',')}
        disabled={disabled || loading}
        onChange={onFileSelected}
        data-testid='series-setup-logo-input'
      />
      <SlotRow>
        {box}
        <SlotInfo>{info}</SlotInfo>
      </SlotRow>
      <Hint>
        {t('lobbies.seriesSetup.logoHint', {
          defaultValue: 'PNG, WebP or SVG, up to {{size}} MB.',
          size: BEST_OF_LOGO_MAX_SIZE_MB,
        })}
      </Hint>
      {error ? (
        <ErrorText role='alert' data-testid='series-setup-logo-error'>
          <ErrorIcon icon='error' size={16} />
          <span>{error}</span>
        </ErrorText>
      ) : null}
    </Root>
  )
}
