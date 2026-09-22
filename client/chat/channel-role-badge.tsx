import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { Tooltip } from '../material/tooltip'
import { ChannelContext } from './channel-context'
import { ChannelRole, useChannelRole } from './channel-role'

const BadgeRoot = styled(Tooltip)`
  /*
    The tooltip wrapper inherits its display from whatever it's dropped into, so it's pinned here
    to keep the glyph a box of its own either way. The downward shift settles a 16px glyph against
    the text it follows rather than letting it ride above the baseline; it does nothing where the
    badge is laid out as a flex item instead.
  */
  display: inline-flex;
  align-items: center;
  vertical-align: -3px;
  /*
    A chat message line hangs its first line into the timestamp gutter with a negative text-indent,
    which inherits; left alone it drags the glyph that far out of the badge's box and over the name.
  */
  text-indent: 0;
`

const BadgeGlyph = styled.span<{ $role: ChannelRole }>`
  display: inline-flex;
  align-items: center;

  /* The shape carries the meaning (a crown for the owner, a shield for a moderator); the colors
     only reinforce it. */
  color: ${props => (props.$role === 'owner' ? 'var(--color-amber80)' : 'var(--color-blue80)')};
`

/**
 * A compact icon marking a user's standing in the chat channel currently being displayed: a crown
 * for its owner, a shield for a member holding moderation permissions in it. Renders nothing for
 * everyone else, and for a channel whose roles this client doesn't know.
 */
export function ChannelRoleBadge({ userId, className }: { userId: SbUserId; className?: string }) {
  const { t } = useTranslation()
  const { channelId } = useContext(ChannelContext)
  const role = useChannelRole(channelId, userId)

  if (!role) {
    return null
  }

  const label =
    role === 'owner'
      ? t('chat.channelRole.owner', 'Channel owner')
      : t('chat.channelRole.moderator', 'Channel moderator')

  return (
    // A badge is not a tab stop: a channel's message history can hold hundreds of them, and they
    // say nothing the name they sit beside doesn't already lead to.
    <BadgeRoot className={className} text={label} position='top' tabIndex={-1}>
      <BadgeGlyph $role={role} role='img' aria-label={label}>
        <MaterialIcon icon={role === 'owner' ? 'crown' : 'shield'} size={16} />
      </BadgeGlyph>
    </BadgeRoot>
  )
}

/**
 * The role badge as it sits after an author's name in a message line: separated from the name it
 * follows, with the name element's own trailing margin separating it from the message text.
 */
export const MessageRoleBadge = styled(ChannelRoleBadge)`
  margin-left: 4px;
`
