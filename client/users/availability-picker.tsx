import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_USER_AVAILABILITIES,
  MAX_STATUS_MESSAGE_LENGTH,
  UserAvailability,
} from '../../common/users/availability'
import { RestrictionKind } from '../../common/users/restrictions'
import { MaterialIcon } from '../icons/material/material-icon'
import { MenuItem } from '../material/menu/item'
import { TextField } from '../material/text-field'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { mergeAccountSettings } from '../settings/action-creators'
import { getAvailabilityColor, getAvailabilityLabel } from './availability'

const Root = styled.div`
  display: flex;
  flex-direction: column;
`

const ColorDot = styled.div<{ $color: string }>`
  width: 12px;
  height: 12px;
  margin: 6px;

  background-color: ${props => props.$color};
  border-radius: 50%;
`

const CheckIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const MessageField = styled(TextField)`
  margin: 4px 12px 0;
`

/**
 * Lets the current user set their availability and status message. Changes save to the account
 * right away, and show on every session logged into it.
 */
export function AvailabilityPicker() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const availability = useAppSelector(s => s.settings.account.availability)
  const statusMessage = useAppSelector(s => s.settings.account.statusMessage)
  // Other users don't see a chat-restricted user's status message, and the server won't set one.
  const isChatRestricted = useAppSelector(
    s => !!s.auth.self?.restrictions.has(RestrictionKind.Chat),
  )
  // Only set while the user is editing, so a message changed by another session shows up here
  // whenever this one isn't mid-edit.
  const [draftMessage, setDraftMessage] = useState<string>()

  const commitMessage = () => {
    if (draftMessage === undefined) {
      return
    }

    const trimmed = draftMessage.trim()
    setDraftMessage(undefined)
    if (trimmed !== statusMessage) {
      dispatch(
        mergeAccountSettings(
          { statusMessage: trimmed },
          { onSuccess: () => {}, onError: () => {} },
        ),
      )
    }
  }

  return (
    <Root role='listbox' aria-label={t('users.availability.pickerLabel', 'Availability')}>
      {ALL_USER_AVAILABILITIES.map(a => (
        <MenuItem
          key={a}
          role='option'
          aria-selected={a === availability}
          icon={<ColorDot $color={getAvailabilityColor(a)} />}
          text={getAvailabilityLabel(a, t)}
          secondaryText={
            a === UserAvailability.DoNotDisturb
              ? t('users.availability.doNotDisturbDescription', 'Mutes message sounds and alerts')
              : undefined
          }
          trailingContent={a === availability ? <CheckIcon icon='check' size={20} /> : undefined}
          testName={`availability-${a}`}
          onClick={() => {
            if (a !== availability) {
              dispatch(
                mergeAccountSettings(
                  { availability: a },
                  { onSuccess: () => {}, onError: () => {} },
                ),
              )
            }
          }}
        />
      ))}
      <MessageField
        dense={true}
        label={t('users.availability.statusMessage', 'Status message')}
        value={draftMessage ?? statusMessage}
        allowErrors={false}
        disabled={isChatRestricted}
        hasClearButton={true}
        inputProps={{ maxLength: MAX_STATUS_MESSAGE_LENGTH }}
        testName='availability-status-message'
        onChange={event => setDraftMessage(event.target.value)}
        onEnterKeyDown={commitMessage}
        onBlur={commitMessage}
      />
    </Root>
  )
}
