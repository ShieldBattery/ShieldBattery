import { Immutable } from 'immer'
import { ChannelBannerId, ChannelBannerJson } from '../../common/chat-channels/channel-banners'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface ChannelBannerState {
  /** An array of channel banners that are available to us. */
  availableChannelBanners: ChannelBannerId[]
  /** An array of default channel banners. */
  defaultChannelBanners: ChannelBannerId[]
  /** A map of channel banner ID -> channel banner info (used in channel info card, etc.) */
  idToInfo: Map<ChannelBannerId, ChannelBannerJson>
}

const DEFAULT_CHANNEL_BANNER_STATE: Immutable<ChannelBannerState> = {
  availableChannelBanners: [],
  defaultChannelBanners: [],
  idToInfo: new Map(),
}

export default immerKeyedReducer(DEFAULT_CHANNEL_BANNER_STATE, {
  ['@chat/getChannelBanners'](state, action) {
    const { availableChannelBanners, defaultChannelBanners } = action.payload

    for (const banner of availableChannelBanners) {
      state.idToInfo.set(banner.id, banner)
    }
    for (const banner of defaultChannelBanners) {
      state.idToInfo.set(banner.id, banner)
    }

    state.availableChannelBanners = availableChannelBanners.map(b => b.id)
    state.defaultChannelBanners = defaultChannelBanners.map(b => b.id)
  },

  ['@chat/getBatchChannelBanner'](state, action) {
    if (action.error) {
      return
    }

    for (const banner of action.payload.channelBanners) {
      state.idToInfo.set(banner.id, banner)
    }
  },

  ['@chat/searchChannels'](state, action) {
    const { channelBanners } = action.payload

    for (const banner of channelBanners) {
      state.idToInfo.set(banner.id, banner)
    }
  },

  ['@network/connect']() {
    return DEFAULT_CHANNEL_BANNER_STATE
  },
})
