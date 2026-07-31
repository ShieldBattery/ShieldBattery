/**
 * How discoverable a lobby is. `listed` lobbies are published on the public lobby list; `unlisted`
 * ones never are, so they can only be reached by someone who has been given their id.
 */
export type LobbyVisibility = 'listed' | 'unlisted'

export const ALL_LOBBY_VISIBILITIES: ReadonlyArray<LobbyVisibility> = ['listed', 'unlisted']
