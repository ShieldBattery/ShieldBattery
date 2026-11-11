# SC:R native HTTPS traffic

Investigation date: September 21, 2026.

## Confirmed during ShieldBattery launches

SC:R initializes Blizzard services independently of ShieldBattery's gameplay
transport. A normal launch without local-play flags opened a Blizzard HTTPS
connection, as did each SC:R process in a local named-pipe match. The normal-launch
control was a solo game, not a live relay match.

An opt-in DNS trace in the game DLL recorded `telemetry-in.battle.net` in both the
visible and hidden clients. At the same time, their established HTTPS connections
were to `137.221.104.171:443`. Earlier runs used `137.221.105.136` and
`137.221.105.232`. Do not hardcode these addresses: the hostname rotates addresses.

For the traced x64 match, both lookups occurred at approximately 02:43:55 UTC on
September 22. Countdown began at 02:43:57 and gameplay at 02:44:03. The clients
remained synced, and normal exit cleaned up the bot. These timestamps establish
ordering, not how much time telemetry added to startup.

The trace also saw `localhost`. Each process retained internal loopback sockets.
ShieldBattery's local turns and app control used named pipes throughout; those
loopback sockets and HTTPS connections belong to native SC:R services.

## What the bundled SDK contains

The installed `ClientSdk.dll` contains a telemetry transport with these endpoint
strings:

- `https://telemetry-in.battle.net` with `/data`, `/flowrules`, and `/health`.
- Ingest/flow/health endpoint diagnostics, batching, retries, flow-rule caching,
  HTTP status diagnostics, and `application/octet-stream`.
- `Telemetry.Enabled`, `Telemetry.Metric.Enabled`, `Telemetry.ProcessInterval`,
  `Telemetry.MaxPendingCount`, and `Telemetry.MaxBatchSize` settings.

Its schema names include process start/finish, network connection/quality metrics,
and classic-game latency/turn-rate, file-store, browser-error, TLS, and RPC events.
Context schemas support program/version, OS/architecture, process, host, device,
and session identifiers. This is a capability inventory, **not evidence that every
field or event was sent by these games**. The investigation did not decrypt HTTPS
or capture request bodies, so individual HTTP paths and payloads remain unverified
on the wire.

The SDK also contains version-metadata and checkout URLs, including
`connect.classic.blizzard.com/.../game_version.pb` and `nydus.battle.net` checkout
pages. Their presence does not establish that an SB match contacts them. Neither
hostname appeared in the traced launch.

## Initialization and possible optimization

In the analyzed SC:R executables, the game builds a string array containing
`Telemetry.Tags=Starcraft`, `Telemetry.ProgramVersion=...`, and a conditional China
endpoint override. It passes the count and array to ClientSdk's ordinal-2 export.
The SDK configuration is separate from the app's ordinary CSettings JSON; simply
adding `Telemetry.Enabled` to CSettings has not been shown to work.

The most promising optimization is to disable telemetry through that native
configuration before its service starts. This could avoid connection setup,
background batching, and retry work. There is currently **no measured startup or
CPU saving** from doing so. A proper comparison needs repeated launches with the
same cache state, measuring native initialization, ready-to-play time, CPU time,
and connections. A successful change must also preserve SDK facilities used by
SC:R for local operation.

Two experiments were set aside:

- Denying socket creation caused a startup breakpoint. The SDK needs more than
  outbound internet access, so blanket socket denial is unsuitable.
- Directly hooking the SDK settings export failed during hook installation with
  `VirtualProtect` error 87. It never established whether the setting was accepted.
  The hook was removed and both game DLLs rebuilt. Export/module ownership and
  the SDK's mapped/protected sections need investigation before retrying.

The retained implementation rejects DNS resolution for exactly
`telemetry-in.battle.net` and SC:R's China equivalent,
`telemetry-in.battlenet.com.cn`. It uses the standard `WSAHOST_NOT_FOUND` return and
last-error value, and clears the result pointer. All other lookups are forwarded.
This behavior applies to every injected ShieldBattery client, including ordinary
networked games; there is no user preference or suppression environment switch.
The purpose is to avoid contributing modified-client activity to Blizzard's
telemetry, not a proven performance improvement.

An x64 live match with the DNS failure reached play, retained matching sync probes,
and showed only loopback TCP connections in the process snapshots. The SDK retried
roughly every ten seconds initially, followed by a short burst; no further retries
appeared in the subsequent minute of observation. A 30-second hidden-client sample
measured 4.47% of one CPU core, compared with an earlier 4.42% sample without the
failure. These short, non-identical runs show no obvious CPU regression and do not
establish a statistically meaningful speedup. Startup was about fifteen seconds
in both traced local matches, including sequential launches and game countdown.

The final default also passed a 32-bit local match with two hidden ZZZKBots:
all three clients agreed through frame 960 and normal exit reported `finished`.
An ordinary 32-bit solo launch without local-play flags reached frame 829; its
connection snapshot contained only loopback connections (including the normal
app-control WebSocket). A full online relay match remains an additional regression
case; non-telemetry resolver calls are forwarded unchanged by the hook.

Returning host-not-found follows the documented [Winsock getaddrinfo failure
contract](https://learn.microsoft.com/en-us/windows/win32/api/ws2tcpip/nf-ws2tcpip-getaddrinfo).
This is an exact-host policy, not a blanket network sandbox; other native services
could still connect if activated.

## Reproducing the observations

Set `SB_TRACE_SC_NETWORK=1` when launching a development Electron process. The
debug game DLL logs native `getaddrinfo` / `GetAddrInfoW` hostnames in addition to
the always-enabled telemetry policy. The trace does not log request bodies, credentials, or TLS contents.
The two APIs can call each other, so paired log lines need not mean two separate
requests. The variable controls diagnostic logging only; release DLLs also enforce
the telemetry policy.

Match `Get-NetTCPConnection` records to the particular SC:R process IDs. The DNS
trace is not a complete packet capture: direct IP use, other resolution APIs,
connections established before hook installation, and other SDK activity could
escape it. Do not equate an absence of logged names with a network sandbox.

## Binary provenance and analysis locations

Live launches used SC:R **1.23.10.13515**, with ClientSdk **1.12.56.118** on both
architectures. The open Binary Ninja databases are older SC:R builds: x64 12310g
and x86 12409. Their initialization code guides research but is not a stable
address contract for the installed build.

| Evidence                                            | x64           | x86        |
| --------------------------------------------------- | ------------- | ---------- |
| SC telemetry settings initializer, analysis VA      | `0x1404394a0` | `0x7de6f0` |
| SC call to SDK ordinal 2, analysis VA               | `0x14043672c` | `0x7db876` |
| Installed SDK ordinal 2, RVA                        | `0x2e4560`    | `0x235a50` |
| Installed SDK `Telemetry.Enabled` string, RVA       | `0xca7e00`    | `0x9b0b80` |
| Installed SDK production telemetry host string, RVA | `0xcaead8`    | `0x9b4974` |

The x86 caller cleans up the two settings arguments itself (cdecl); the x64 caller
uses the Windows x64 ABI. Any eventual implementation must support both and avoid
hardcoded executable addresses.
