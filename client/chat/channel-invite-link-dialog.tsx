import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ChannelInviteLinkJson,
  DEFAULT_INVITE_LINK_EXPIRY_SECONDS,
  INVITE_LINK_EXPIRY_OPTIONS_SECONDS,
  INVITE_LINK_MAX_USES_OPTIONS,
  SbChannelId,
} from '../../common/chat'
import { getErrorStack } from '../../common/errors'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useFormatLocale } from '../i18n/locale-formats'
import logger from '../logging/logger'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { getServerOrigin } from '../network/server-url'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, BodyMedium, bodyMedium, singleLine, titleSmall } from '../styles/typography'
import { getChannelInviteLink } from './action-creators'
import { urlForChannelInvite } from './channel-url'
import {
  describeInviteLinkExpiry,
  describeInviteLinkUseLimit,
  getInviteLinkExpiryOptionLabel,
  getInviteLinkMaxUsesOptionLabel,
} from './invite-link-text'

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Description = styled(BodyMedium)`
  color: var(--theme-on-surface-variant);
`

const LinkBox = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 16px;

  background-color: var(--theme-container-lowest);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const LinkText = styled.div<{ $placeholder: boolean }>`
  ${bodyLarge};
  ${singleLine};
  flex-grow: 1;
  min-width: 0;

  color: ${props =>
    props.$placeholder ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
  user-select: text;
`

const LinkDetails = styled.div<{ $error: boolean }>`
  ${bodyMedium};
  margin-top: -8px;
  color: ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-on-surface-variant)')};
`

const SectionTitle = styled.div`
  ${titleSmall};
  margin-top: 8px;
`

const SettingsRow = styled.div`
  display: flex;
  gap: 16px;

  & > * {
    flex: 1 1 0;
    min-width: 0;
  }
`

const GenerateButton = styled(OutlinedButton)`
  align-self: flex-start;
`

type ExpiryChoice = number | 'never'
type MaxUsesChoice = number | 'unlimited'

interface ShownLink {
  inviteLink: ChannelInviteLinkJson
  /** When the link was received, which its expiry is described relative to. */
  receivedAt: number
}

export interface ChannelInviteLinkDialogProps extends CommonDialogProps {
  channelId: SbChannelId
}

/**
 * Shows an invite link into a private channel for the user to copy, starting with their default
 * link, and lets them generate a new one with a different expiry or use limit instead.
 */
export function ChannelInviteLinkDialog({ onCancel, channelId }: ChannelInviteLinkDialogProps) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const channelName = useAppSelector(s => s.chat.idToBasicInfo.get(channelId)?.name)

  const [shownLink, setShownLink] = useState<ShownLink>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_INVITE_LINK_EXPIRY_SECONDS)
  const [maxUses, setMaxUses] = useState<MaxUsesChoice>('unlimited')

  useEffect(() => {
    const abortController = new AbortController()

    dispatch(
      getChannelInviteLink(channelId, undefined, {
        signal: abortController.signal,
        onSuccess: inviteLink => {
          setShownLink({ inviteLink, receivedAt: Date.now() })
        },
        onError: () => {
          setLoadFailed(true)
        },
      }),
    )

    return () => abortController.abort()
  }, [channelId, dispatch])

  const url = shownLink
    ? getServerOrigin() + urlForChannelInvite(shownLink.inviteLink.token)
    : undefined

  const onCopyClick = () => {
    if (!url) {
      return
    }

    navigator.clipboard
      .writeText(url)
      .then(() => {
        snackbarController.showSnackbar(
          t('chat.inviteLinkDialog.copied', 'Invite link copied to clipboard'),
        )
      })
      .catch(err => {
        logger.error(`Error writing to clipboard: ${getErrorStack(err)}`)
        snackbarController.showSnackbar(
          t('chat.inviteLinkDialog.copyError', 'Something went wrong copying the invite link'),
        )
      })
  }

  const onGenerateClick = () => {
    setIsGenerating(true)
    dispatch(
      getChannelInviteLink(
        channelId,
        {
          expiresInSeconds: expiry === 'never' ? null : expiry,
          maxUses: maxUses === 'unlimited' ? null : maxUses,
        },
        {
          onSuccess: inviteLink => {
            setIsGenerating(false)
            setLoadFailed(false)
            setShownLink({ inviteLink, receivedAt: Date.now() })
          },
          onError: () => {
            setIsGenerating(false)
            snackbarController.showSnackbar(
              t(
                'chat.inviteLinkDialog.generateError',
                'Something went wrong generating a new invite link',
              ),
            )
          },
        },
      ),
    )
  }

  let linkText: string
  if (url) {
    linkText = url
  } else if (loadFailed) {
    linkText = t('chat.inviteLinkDialog.noLink', 'No link available')
  } else {
    linkText = t('chat.inviteLinkDialog.loading', 'Getting a link…')
  }

  let details: string | undefined
  if (shownLink) {
    details = `${describeInviteLinkExpiry(shownLink.inviteLink, shownLink.receivedAt, locale, t)} · ${describeInviteLinkUseLimit(shownLink.inviteLink, t)}`
  } else if (loadFailed) {
    details = t(
      'chat.inviteLinkDialog.loadError',
      'Something went wrong getting an invite link. You can still generate a new one below.',
    )
  }

  return (
    <Dialog
      title={t('chat.inviteLinkDialog.title', 'Invite link')}
      buttons={[
        <TextButton
          key='done'
          label={t('common.actions.done', 'Done')}
          onClick={onCancel}
          testName='channel-invite-link-dialog-done-button'
        />,
      ]}
      onCancel={onCancel}
      testName='channel-invite-link-dialog'>
      <Content>
        <Description>
          {channelName
            ? t('chat.inviteLinkDialog.description', {
                defaultValue: 'Anyone with this link can join #{{channelName}}.',
                channelName,
              })
            : t(
                'chat.inviteLinkDialog.descriptionNoName',
                'Anyone with this link can join the channel.',
              )}
        </Description>

        <LinkBox>
          <LinkText $placeholder={!url} data-testid='channel-invite-link-dialog-url'>
            {linkText}
          </LinkText>
          <FilledButton
            label={t('chat.inviteLinkDialog.copy', 'Copy')}
            disabled={!url}
            onClick={onCopyClick}
            testName='channel-invite-link-dialog-copy-button'
          />
        </LinkBox>
        {details ? <LinkDetails $error={!shownLink}>{details}</LinkDetails> : null}

        <SectionTitle>{t('chat.inviteLinkDialog.editSettings', 'Edit link settings')}</SectionTitle>
        <SettingsRow>
          <Select
            label={t('chat.inviteLinkDialog.expiryLabel', 'Expire after')}
            value={expiry}
            allowErrors={false}
            disabled={isGenerating}
            onChange={setExpiry}>
            {INVITE_LINK_EXPIRY_OPTIONS_SECONDS.map(seconds => (
              <SelectOption
                key={seconds}
                value={seconds}
                text={getInviteLinkExpiryOptionLabel(seconds, t)}
              />
            ))}
            <SelectOption value='never' text={getInviteLinkExpiryOptionLabel(null, t)} />
          </Select>
          <Select
            label={t('chat.inviteLinkDialog.maxUsesLabel', 'Maximum uses')}
            value={maxUses}
            allowErrors={false}
            disabled={isGenerating}
            onChange={setMaxUses}>
            <SelectOption value='unlimited' text={getInviteLinkMaxUsesOptionLabel(null, t)} />
            {INVITE_LINK_MAX_USES_OPTIONS.map(uses => (
              <SelectOption
                key={uses}
                value={uses}
                text={getInviteLinkMaxUsesOptionLabel(uses, t)}
              />
            ))}
          </Select>
        </SettingsRow>
        <GenerateButton
          label={t('chat.inviteLinkDialog.generate', 'Generate new link')}
          disabled={isGenerating}
          onClick={onGenerateClick}
          testName='channel-invite-link-dialog-generate-button'
        />
      </Content>
    </Dialog>
  )
}
