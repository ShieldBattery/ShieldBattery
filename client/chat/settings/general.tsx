import { debounce } from 'lodash-es'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { EditChannelRequest, SbChannelId } from '../../../common/chat'
import { useForm } from '../../forms/form-hook'
import { MaterialIcon } from '../../icons/material/material-icon'
import { TextField } from '../../material/text-field'
import { useAppDispatch } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { colorError, colorSuccess } from '../../styles/colors'
import { subtitle1 } from '../../styles/typography'
import { updateChannel } from '../action-creators'

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
  margin-bottom: 8px;
`

const SuccessIcon = styled(MaterialIcon).attrs({ icon: 'check_circle' })`
  color: ${colorSuccess};
`

enum UpdateStatus {
  Updating,
  Success,
  Error,
}

interface ChannelSettingsGeneralModel {
  description?: string
  topic?: string
}

interface ChannelSettingsGeneralProps {
  channelId: SbChannelId
  channelDescription?: string
  channelTopic?: string
}

export function ChannelSettingsGeneral({
  channelId,
  channelDescription: originalChannelDescription,
  channelTopic: originalChannelTopic,
}: ChannelSettingsGeneralProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [error, setError] = useState<Error>()
  const [descriptionUpdateStatus, setDescriptionUpdateStatus] = useState<UpdateStatus>()
  const [topicUpdateStatus, setTopicUpdateStatus] = useState<UpdateStatus>()

  const debouncedUpdateChannelRef = useRef(
    debounce((patch: EditChannelRequest) => {
      dispatch(
        updateChannel(channelId, patch, {
          onSuccess: () => {
            setError(undefined)

            if (patch.description !== undefined) {
              setDescriptionUpdateStatus(UpdateStatus.Success)
            }
            if (patch.topic !== undefined) {
              setTopicUpdateStatus(UpdateStatus.Success)
            }
          },
          onError: err => {
            setDescriptionUpdateStatus(UpdateStatus.Error)
            setTopicUpdateStatus(UpdateStatus.Error)
            setError(err)
          },
        }),
      )
    }, 500),
  )

  const onValidatedChange = useStableCallback((model: Readonly<ChannelSettingsGeneralModel>) => {
    const patch: EditChannelRequest = {
      description: model.description !== originalChannelDescription ? model.description : undefined,
      topic: model.topic !== originalChannelTopic ? model.topic : undefined,
    }

    if (patch.description !== undefined) {
      setDescriptionUpdateStatus(UpdateStatus.Updating)
    }
    if (patch.topic !== undefined) {
      setTopicUpdateStatus(UpdateStatus.Updating)
    }

    debouncedUpdateChannelRef.current(patch)
  })

  const { bindInput, onSubmit } = useForm(
    {
      description: originalChannelDescription,
      topic: originalChannelTopic,
    },
    {},
    { onValidatedChange },
  )

  return (
    <div>
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      <form noValidate={true} onSubmit={onSubmit}>
        <TextField
          {...bindInput('description')}
          label={t('chat.channelSettings.general.descriptionLabel', 'Description')}
          floatingLabel={true}
          trailingIcons={
            descriptionUpdateStatus === UpdateStatus.Success
              ? [<SuccessIcon key='success' />]
              : undefined
          }
          inputProps={{ tabIndex: 0 }}
        />
        <TextField
          {...bindInput('topic')}
          label={t('chat.channelSettings.general.topicLabel', 'Topic')}
          floatingLabel={true}
          trailingIcons={
            topicUpdateStatus === UpdateStatus.Success ? [<SuccessIcon key='success' />] : undefined
          }
          inputProps={{ tabIndex: 0 }}
        />
      </form>
    </div>
  )
}
