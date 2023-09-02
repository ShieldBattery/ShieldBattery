import { debounce } from 'lodash-es'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { EditChannelRequest, SbChannelId } from '../../common/chat'
import { ChannelBannerId, ChannelBannerJson } from '../../common/chat-channels/channel-banners'
import { useForm } from '../forms/form-hook'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton, useButtonState } from '../material/button'
import Card from '../material/card'
import { Ripple } from '../material/ripple'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import {
  blue600,
  colorError,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { subtitle1 } from '../styles/typography'
import { getChannelBanners, updateChannel } from './action-creators'
import { ChannelBanner } from './channel-banner'

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
  margin-bottom: 8px;
`

const EmptyListText = styled.div`
  ${subtitle1};
  color: ${colorTextFaint};
`

const Overline = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const ListContainer = styled.div`
  & + & {
    margin-top: 32px;
  }
`

const BannerList = styled.div`
  padding-top: 8px;

  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

interface ChannelSettingsBannerModel {
  bannerId?: ChannelBannerId
}

interface ChannelSettingsBannerProps {
  channelId: SbChannelId
  bannerId?: ChannelBannerId
}

export function ChannelSettingsBanner({
  channelId,
  bannerId: originalBannerId,
}: ChannelSettingsBannerProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const availableBanners = useAppSelector(s => s.channelBanners.availableChannelBanners)
  const defaultBanners = useAppSelector(s => s.channelBanners.defaultChannelBanners)
  const bannerIdToInfo = useAppSelector(s => s.channelBanners.idToInfo)

  const [isLoading, setIsLoading] = useState(false)
  const [retrieveError, setRetrieveError] = useState<Error>()
  const [updateError, setUpdateError] = useState<Error>()

  const { availableChannelBanners, defaultChannelBanners } = useMemo(() => {
    const availableChannelBanners = availableBanners.map(id => bannerIdToInfo.get(id)!)
    const defaultChannelBanners = defaultBanners.map(id => bannerIdToInfo.get(id)!)

    return { availableChannelBanners, defaultChannelBanners }
  }, [availableBanners, bannerIdToInfo, defaultBanners])

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    setIsLoading(true)

    dispatch(
      getChannelBanners(channelId, {
        signal,
        onSuccess: res => {
          setIsLoading(false)
          setRetrieveError(undefined)
        },
        onError: err => {
          setIsLoading(false)
          setRetrieveError(err)
        },
      }),
    )

    return () => controller.abort()
  }, [channelId, dispatch])

  const debouncedUpdateChannelRef = useRef(
    debounce((patch: EditChannelRequest) => {
      dispatch(
        updateChannel(channelId, patch, {
          onSuccess: () => {
            setUpdateError(undefined)
          },
          onError: err => {
            setUpdateError(err)
          },
        }),
      )
    }, 500),
  )

  const onValidatedChange = useStableCallback((model: Readonly<ChannelSettingsBannerModel>) => {
    const patch: EditChannelRequest = {
      bannerId: model.bannerId !== originalBannerId ? model.bannerId : undefined,
    }

    debouncedUpdateChannelRef.current(patch)
  })

  const { bindCustom, onSubmit } = useForm(
    {
      bannerId: originalBannerId,
    },
    {},
    { onValidatedChange },
  )

  if (isLoading) {
    return <LoadingDotsArea />
  }
  if (retrieveError) {
    return <ErrorText>{retrieveError.message}</ErrorText>
  }
  if (availableChannelBanners.length === 0 && defaultChannelBanners.length === 0) {
    return <EmptyListText>{t('common.lists.empty', 'Nothing to see here')}</EmptyListText>
  }

  return (
    <div>
      {updateError ? <ErrorText>{updateError.message}</ErrorText> : null}
      <form noValidate={true} onSubmit={onSubmit}>
        <SelectableBannerList
          {...bindCustom('bannerId')}
          availableChannelBanners={availableChannelBanners}
          defaultChannelBanners={defaultChannelBanners}
        />
      </form>
    </div>
  )
}

function SelectableBannerList({
  name,
  value,
  onChange,
  availableChannelBanners,
  defaultChannelBanners,
}: {
  name: string
  value?: ChannelBannerId | null
  onChange: (newValue: ChannelBannerId) => void
  availableChannelBanners: ReadonlyDeep<ChannelBannerJson[]>
  defaultChannelBanners: ReadonlyDeep<ChannelBannerJson[]>
}) {
  const { t } = useTranslation()
  return (
    <>
      {availableChannelBanners.length ? (
        <ListContainer>
          <Overline>
            {t('chat.channelSettings.banner.availableOverline', 'Available channel banners')}
          </Overline>
          <BannerList>
            {availableChannelBanners.map(b => (
              <ChannelBannerCard
                key={b.id}
                banner={b}
                isSelected={value === b.id}
                onClick={() => onChange(b.id)}
              />
            ))}
          </BannerList>
        </ListContainer>
      ) : null}
      {defaultChannelBanners.length ? (
        <ListContainer>
          <Overline>
            {t('chat.channelSettings.banner.defaultOverline', 'Default channel banners')}
          </Overline>
          <BannerList>
            {defaultChannelBanners.map(b => (
              <ChannelBannerCard
                key={b.id}
                banner={b}
                isSelected={value === b.id}
                onClick={() => onChange(b.id)}
              />
            ))}
          </BannerList>
        </ListContainer>
      ) : null}
    </>
  )
}

const ChannelCardRoot = styled(Card)<{ $isSelected: boolean }>`
  position: relative;
  width: 248px;
  padding: 0;

  display: flex;
  flex-direction: column;

  contain: content;
  cursor: pointer;

  ${props => {
    if (props.$isSelected) {
      return css`
        border: 2px solid ${blue600};
      `
    }

    return ''
  }}
`

const SelectedIcon = styled(MaterialIcon).attrs({ icon: 'check_circle' })`
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 0;

  color: ${blue600};

  &::before {
    content: '';
    position: absolute;
    top: 4px;
    left: 4px;
    width: calc(100% - 8px);
    height: calc(100% - 8px);
    border-radius: 50%;
    background-color: ${colorTextPrimary};
    z-index: -1;
  }
`

const ChannelBannerImageLink = styled.a`
  position: absolute;
  top: 4px;
  right: 4px;
`

interface ChannelBannerCardProps {
  banner: ReadonlyDeep<ChannelBannerJson>
  isSelected: boolean
  onClick?: (event: React.MouseEvent) => void
}

function ChannelBannerCard({ banner, isSelected, onClick }: ChannelBannerCardProps) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({ onClick })

  const onLinkClick = (event: React.MouseEvent) => {
    event.stopPropagation()
  }

  return (
    <ChannelCardRoot {...buttonProps} $isSelected={isSelected}>
      <ChannelBanner src={banner.imagePath} />

      {isSelected ? <SelectedIcon /> : null}

      <ChannelBannerImageLink
        href={banner.imagePath}
        target='_blank'
        rel='noopener'
        onClick={onLinkClick}>
        <IconButton
          icon={<MaterialIcon icon='zoom_in' />}
          title={t('chat.channelSettings.banner.openFullSize', 'Open full size')}
        />
      </ChannelBannerImageLink>

      <Ripple ref={rippleRef} />
    </ChannelCardRoot>
  )
}
