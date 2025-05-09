import { SbUserId as _SbUserId } from '../common/users/sb-user-id'

// Add any types in here that you want to use for Typeshare generation (and then update the type
// mapping in typeshare.toml). No serialization/deserialization logic will be present, so these can
// only be things like opaque types.

declare global {
  /** @deprecated Only for use in typeshare generated types, don't use directly */
  namespace TypeshareTypes {
    type SbUserId = _SbUserId
  }
}
