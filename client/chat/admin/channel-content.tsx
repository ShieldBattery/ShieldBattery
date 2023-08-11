import React, { useContext, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { Route, RouteComponentProps, Switch } from 'wouter'
import { BasicChannelInfo, SbChannelId } from '../../../common/chat'
import {
  AdminEditChannelBannerRequest,
  CHANNEL_BANNER_HEIGHT,
  CHANNEL_BANNER_WIDTH,
  ChannelBannerJson,
  makeChannelBannerId,
} from '../../../common/chat-channels/channel-banners'
import { CHANNEL_ALLOWED_CHARACTERS } from '../../../common/constants'
import { urlPath } from '../../../common/urls'
import { FileInput } from '../../forms/file-input'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { required } from '../../forms/validators'
import { MaterialIcon } from '../../icons/material/material-icon'
import { IconButton, RaisedButton } from '../../material/button'
import Card from '../../material/card'
import { TextField } from '../../material/text-field'
import { push } from '../../navigation/routing'
import { useRefreshToken } from '../../network/refresh-token'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { colorError, colorTextFaint, colorTextSecondary } from '../../styles/colors'
import { FlexSpacer } from '../../styles/flex-spacer'
import { body1, headline4, headline6, subtitle1 } from '../../styles/typography'
import {
  adminGetChannelBanner,
  adminGetChannelBanners,
  adminUpdateChannelBanner,
  adminUploadChannelBanner,
} from '../action-creators'
import { ChannelBanner } from '../channel-banner'

const AVAILABLE_IN_REGEX = new RegExp(CHANNEL_ALLOWED_CHARACTERS, 'gi')

const Root = styled.div`
  padding: 12px 24px;
`

const Title = styled.div`
  ${headline4};
`

const ListRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionLabel = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const CardList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const ChannelContentContext = React.createContext<{ triggerRefresh: () => void }>({
  triggerRefresh: () => {},
})

export function AdminChannelContent() {
  const dispatch = useAppDispatch()
  const [channelBanners, setChannelBanners] = useState<ReadonlyDeep<ChannelBannerJson[]>>([])
  const [channelInfos, setChannelInfos] = useState<
    ReadonlyDeep<Map<SbChannelId, BasicChannelInfo>>
  >(new Map())
  const [error, setError] = useState<Error>()
  const [refreshToken, triggerRefresh] = useRefreshToken()

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    dispatch(
      adminGetChannelBanners({
        signal,
        onSuccess: res => {
          setChannelBanners(res.channelBanners)
          setChannelInfos(new Map(res.channelInfos.map(c => [c.id, c])))
          setError(undefined)
        },
        onError: err => {
          setError(err)
        },
      }),
    )

    return () => controller.abort()
  }, [dispatch, refreshToken])

  const contextValue = useMemo(() => {
    return { triggerRefresh }
  }, [triggerRefresh])

  return (
    <Root>
      <ChannelContentContext.Provider value={contextValue}>
        <Switch>
          <Route path='/chat/admin/channel-content/banners/upload' component={UploadBanner} />
          <Route path='/chat/admin/channel-content/banners/:id' component={EditBanner} />
          <Route>
            <ListRoot>
              <Title>Channel content</Title>
              <div>
                <RaisedButton
                  label='Upload banner'
                  iconStart={<MaterialIcon icon='add' />}
                  onClick={() => push('/chat/admin/channel-content/banners/upload')}
                />
              </div>
              {error ? <ErrorText>{error.message}</ErrorText> : null}

              <SectionLabel>Banners</SectionLabel>
              <CardList>
                {channelBanners.map(b => (
                  <ChannelBannerCard key={b.id} banner={b} channelInfos={channelInfos} />
                ))}
              </CardList>
            </ListRoot>
          </Route>
        </Switch>
      </ChannelContentContext.Provider>
    </Root>
  )
}

const ChannelCardRoot = styled(Card)`
  position: relative;
  width: 352px;
  padding: 0;

  display: flex;
  flex-direction: column;

  contain: content;
`

const ChannelCardContents = styled.div`
  flex-grow: 1;
  padding: 16px 16px 10px 16px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ChannelBannerName = styled.div`
  ${headline6};
`

const ChannelListLabel = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const ChannelList = styled.ul`
  margin: 0;
`

const ChannelListEntry = styled.li`
  margin: 0;
  color: ${colorTextSecondary};
`

const ChannelActions = styled.div`
  display: flex;
  justify-content: space-between;
`

const LimitedIndicator = styled.div`
  ${body1};

  display: flex;
  align-items: center;
  gap: 4px;

  color: ${colorTextFaint};
`

const ChannelBannerImageLink = styled.a`
  position: absolute;
  top: 4px;
  right: 4px;
`

function ChannelBannerCard({
  banner,
  channelInfos,
}: {
  banner: ReadonlyDeep<ChannelBannerJson>
  channelInfos: ReadonlyDeep<Map<SbChannelId, BasicChannelInfo>>
}) {
  return (
    <ChannelCardRoot>
      <ChannelBanner src={banner.imagePath} />

      <ChannelBannerImageLink href={banner.imagePath} target='_blank' rel='noopener'>
        <IconButton icon={<MaterialIcon icon='zoom_in' />} title='Open full size' />
      </ChannelBannerImageLink>

      <ChannelCardContents>
        <ChannelBannerName>{banner.name}</ChannelBannerName>

        {banner.availableIn.length > 0 ? (
          <>
            <ChannelListLabel>Available in:</ChannelListLabel>
            <ChannelList>
              {banner.availableIn.map(channelId => (
                <ChannelListEntry key={channelId}>
                  {channelInfos.get(channelId)!.name}
                </ChannelListEntry>
              ))}
            </ChannelList>
          </>
        ) : null}

        <FlexSpacer />

        <ChannelActions>
          {banner.limited ? (
            <LimitedIndicator>
              <MaterialIcon icon='check' />
              <span>Limited</span>
            </LimitedIndicator>
          ) : (
            <div />
          )}
          <RaisedButton
            label='Edit'
            onClick={() => push(urlPath`/chat/admin/channel-content/banners/${banner.id}`)}
          />
        </ChannelActions>
      </ChannelCardContents>
    </ChannelCardRoot>
  )
}

const ChannelBannerRoot = styled.div`
  width: 100%;
  padding: 16px 0;
`

const ChannelBannerForm = styled.form`
  margin-top: 16px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
`

const DescriptionText = styled.div`
  ${body1};
  margin-bottom: 8px;

  color: ${colorTextSecondary};
`

const ErrorText = styled.div`
  ${subtitle1};
  margin-bottom: 16px;
  color: ${colorError};
`

interface ChannelBannerModel {
  name: string
  availableIn?: string
  image?: File | File[]
}

function UploadBanner() {
  const channelContentContext = useContext(ChannelContentContext)

  const dispatch = useAppDispatch()
  const [error, setError] = useState<Error>()
  const onFormSubmit = useStableCallback((model: ChannelBannerModel) => {
    if (!model.image) {
      return
    }

    dispatch(
      adminUploadChannelBanner(
        {
          name: model.name,
          availableIn:
            model.availableIn?.match(AVAILABLE_IN_REGEX)?.filter(c => c.trim().length > 0) ?? [],
          image: model.image as File,
        },
        {
          onSuccess: () => {
            setError(undefined)
            channelContentContext.triggerRefresh()
            history.back()
          },
          onError: err => {
            setError(err)
          },
        },
      ),
    )
  })

  const { onSubmit, bindCustom, bindInput } = useForm<ChannelBannerModel>(
    {
      name: '',
    },
    {
      name: required('Banner name is required'),
      image: required('Banner image is required'),
    },
    { onSubmit: onFormSubmit },
  )

  return (
    <ChannelBannerRoot>
      <Title>Upload banner</Title>
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      <ChannelBannerForm noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />

        <div>
          <DescriptionText>
            Banner image ({CHANNEL_BANNER_WIDTH}x{CHANNEL_BANNER_HEIGHT}px recommended)
          </DescriptionText>
          <FileInput
            {...bindCustom('image')}
            allowErrors={true}
            inputProps={{ accept: 'image/*', multiple: false }}
          />
        </div>

        <div>
          <DescriptionText>Descriptive name for the channel banner</DescriptionText>
          <TextField
            {...bindInput('name')}
            label='Banner name'
            floatingLabel={true}
            dense={true}
            inputProps={{ tabIndex: 0 }}
          />
        </div>

        <div>
          <DescriptionText>
            List of channels this banner is available in (whitespace separated)
          </DescriptionText>
          <TextField
            {...bindInput('availableIn')}
            label='Channel list'
            floatingLabel={true}
            dense={true}
            inputProps={{ tabIndex: 0 }}
          />
        </div>

        <RaisedButton label='Upload banner' onClick={onSubmit} />
      </ChannelBannerForm>
    </ChannelBannerRoot>
  )
}

function EditBanner({ params: { id: routeId } }: RouteComponentProps<{ id: string }>) {
  const bannerId = makeChannelBannerId(routeId)
  const channelContentContext = useContext(ChannelContentContext)

  const dispatch = useAppDispatch()
  const [originalChannelBanner, setOriginalChannelBanner] = useState<ChannelBannerJson>()
  const [channelInfos, setChannelInfos] = useState<
    ReadonlyDeep<Map<SbChannelId, BasicChannelInfo>>
  >(new Map())
  const [error, setError] = useState<Error>()

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    dispatch(
      adminGetChannelBanner(bannerId, {
        signal,
        onSuccess: res => {
          setOriginalChannelBanner(res.channelBanner)
          setChannelInfos(new Map(res.channelInfos.map(c => [c.id, c])))
          setError(undefined)
        },
        onError: err => {
          setError(err)
        },
      }),
    )

    return () => controller.abort()
  }, [bannerId, dispatch])

  const onFormSubmit = useStableCallback((model: ChannelBannerModel) => {
    const availableInArray =
      model.availableIn?.match(AVAILABLE_IN_REGEX)?.filter(c => c.trim().length > 0) ?? []
    const originalAvailableInSet = new Set(
      originalChannelBanner?.availableIn.map(id => channelInfos.get(id)?.name),
    )
    const isAvailableInSame =
      availableInArray.length === originalChannelBanner?.availableIn.length &&
      availableInArray.every(value => originalAvailableInSet.has(value))

    const patch: AdminEditChannelBannerRequest & { image?: Blob } = {
      name: model.name !== originalChannelBanner?.name ? model.name : undefined,
      availableIn: !isAvailableInSame ? availableInArray : undefined,
      image: model.image as File,
    }

    dispatch(
      adminUpdateChannelBanner(bannerId, patch, {
        onSuccess: () => {
          setError(undefined)
          channelContentContext.triggerRefresh()
          history.back()
        },
        onError: err => {
          setError(err)
        },
      }),
    )
  })

  return (
    <ChannelBannerRoot>
      <Title>Edit banner</Title>
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      {originalChannelBanner ? (
        <EditBannerForm
          originalChannelBanner={originalChannelBanner}
          channelInfos={channelInfos}
          onSubmit={onFormSubmit}
        />
      ) : (
        <LoadingDotsArea />
      )}
    </ChannelBannerRoot>
  )
}

function EditBannerForm({
  originalChannelBanner,
  channelInfos,
  onSubmit: onFormSubmit,
}: {
  originalChannelBanner: ChannelBannerJson
  channelInfos: ReadonlyDeep<Map<SbChannelId, BasicChannelInfo>>
  onSubmit?: (model: Readonly<ChannelBannerModel>) => void
}) {
  const { onSubmit, bindCustom, bindInput } = useForm<ChannelBannerModel>(
    {
      name: originalChannelBanner?.name ?? '',
      availableIn: originalChannelBanner?.availableIn
        .map(id => channelInfos.get(id)?.name)
        .join(' '),
    },
    {
      name: required('Banner name is required'),
    },
    { onSubmit: onFormSubmit },
  )

  return (
    <ChannelBannerForm noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />

      <div>
        <DescriptionText>
          Banner image ({CHANNEL_BANNER_WIDTH}x{CHANNEL_BANNER_HEIGHT}px recommended). NOTE: Leaving
          this empty will keep the same image.
        </DescriptionText>
        <FileInput {...bindCustom('image')} inputProps={{ accept: 'image/*', multiple: false }} />
      </div>

      <div>
        <DescriptionText>Descriptive name for the channel banner</DescriptionText>
        <TextField
          {...bindInput('name')}
          label='Banner name'
          floatingLabel={true}
          dense={true}
          inputProps={{ tabIndex: 0 }}
        />
      </div>

      <div>
        <DescriptionText>
          List of channels this banner is available in (whitespace separated)
        </DescriptionText>
        <TextField
          {...bindInput('availableIn')}
          label='Channel list'
          floatingLabel={true}
          dense={true}
          inputProps={{ tabIndex: 0 }}
        />
      </div>

      <RaisedButton label='Save banner' onClick={onSubmit} />
    </ChannelBannerForm>
  )
}
