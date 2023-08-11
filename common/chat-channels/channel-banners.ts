import { Opaque } from 'type-fest'
import { BasicChannelInfo, SbChannelId } from '../chat'
import { Jsonify } from '../json'

export const CHANNEL_BANNER_WIDTH = 736 * 2
export const CHANNEL_BANNER_HEIGHT = 414 * 2

export type ChannelBannerId = Opaque<string, 'ChannelBannerId'>

export function makeChannelBannerId(id: string): ChannelBannerId {
  return id as ChannelBannerId
}

export interface ChannelBanner {
  id: ChannelBannerId
  name: string
  limited: boolean
  availableIn: SbChannelId[]
  imagePath: string
  uploadedAt: Date
  updatedAt: Date
}

export type ChannelBannerJson = Jsonify<ChannelBanner>

export function toChannelBannerJson(channelBanner: ChannelBanner): ChannelBannerJson {
  return {
    id: channelBanner.id,
    name: channelBanner.name,
    limited: channelBanner.limited,
    availableIn: channelBanner.availableIn,
    imagePath: channelBanner.imagePath,
    uploadedAt: Number(channelBanner.uploadedAt),
    updatedAt: Number(channelBanner.updatedAt),
  }
}

export interface AdminGetChannelBannersResponse {
  channelBanners: ChannelBannerJson[]
  channelInfos: BasicChannelInfo[]
}

export interface AdminGetChannelBannerResponse {
  channelBanner: ChannelBannerJson
  channelInfos: BasicChannelInfo[]
}

export interface AdminUploadChannelBannerRequest {
  name: string
  availableIn?: string[]
}

export interface AdminUploadChannelBannerResponse {
  channelBanner: ChannelBannerJson
}

export interface AdminEditChannelBannerRequest {
  name?: string
  availableIn?: string[]
  deleteLimited?: boolean
}

export interface AdminEditChannelBannerResponse {
  channelBanner: ChannelBannerJson
}
