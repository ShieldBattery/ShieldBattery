# ShieldBattery Replay Additions

ShieldBattery adds data to replays to aid in identification of games and allow
for improved functionality (such as making Team Melee replays work). This format
is designed to be added to over time, while maintaining compatibility for
readers of the previous format versions.

The version specific fields were added in is noted below, readers should take
care to not attempt to read fields that are not present in the version stored
in a particular replay file.

## General format

### Section Headers

All sections are appended as "normal" replay data sections, having a 4-byte
identifier for the section type followed by a 4-byte little-endian section
length (excluding the 8 bytes of section header).

## ShieldBattery Data section format

- Header: `0x74616253` (`Sbat`)
- Length: Variable, depending on format version

The format of the data is:

| Size       | Description                                                                                |
| ---------- | ------------------------------------------------------------------------------------------ |
| -          | _Added in Version 0_                                                                       |
| `u16`      | format version                                                                             |
| `u32`      | StarCraft EXE Build                                                                        |
| `u8[0x10]` | ShieldBattery version string                                                               |
| `u8[0x4]`  | Team game main players (necessary data for Team Melee replays)                             |
| `u8[0xc]`  | Starting races (necessary data for Team Melee replays)                                     |
| `u128`     | ShieldBattery Game ID (UUID). Can be used with the ShieldBattery API to retrieve game info |
| `u32[0x8]` | ShieldBattery User IDs, ordered the same as ingame players from the normal replay header   |
| -          | _Added in Version 1_                                                                       |
| `u16`      | Game logic version (used to ensure consistent replay playback after game logic changes)    |
| -          | _Added in Version 2_                                                                       |
| `u8`       | [Game source](#game-sources)                                                               |
| _dynamic_  | ShieldBattery server origin as a `u16`-length-prefixed UTF-8 string                        |

#### Game sources

- **0** - Custom game
- **1** - 1v1 Matchmaking
- **2** - 2v2 Matchmaking

Note that more game sources are likely to be added in the future, so readers should be able
to handle unknown values.
