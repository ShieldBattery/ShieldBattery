import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { CHANNEL_HEADER_HEIGHT } from '../chat/channel-header'
import { useAppSelector } from '../redux-hooks'
import { bodyLarge, singleLine, titleLarge } from '../styles/typography'
import { UserStatusText } from './whisper-header'

const Root = styled.div`
  ${bodyLarge};

  position: absolute;
  /* Centered in the space between the header and the message input. */
  inset: ${CHANNEL_HEADER_HEIGHT}px 0 72px;
  padding: 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;

  color: var(--theme-on-surface-variant);
  text-align: center;
  pointer-events: none;
`

const IntroAvatar = styled(ConnectedAvatar)`
  width: 80px;
  height: 80px;
  margin-bottom: 4px;
`

const Username = styled.div`
  ${titleLarge};
  ${singleLine};
  max-width: 100%;
  color: var(--theme-on-surface);
`

/** What a conversation shows before anything has been said in it. */
export function WhisperIntro({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name) ?? ''

  return (
    <Root>
      <IntroAvatar userId={userId} showAvailability={true} />
      <Username>{username}</Username>
      <UserStatusText userId={userId} />
      <div>
        {t('whispers.intro.start', {
          defaultValue: 'This is the start of your whispers with {{username}}.',
          username,
        })}
      </div>
    </Root>
  )
}
