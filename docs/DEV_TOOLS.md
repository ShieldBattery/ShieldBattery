# Dev Tools

## Using Developer Tools with Electron

Electron 9+ causes problems with using various developer tools on non-http pages (which is how our
application is designed to work). Because of this, we stopped installing both the Redux and React
developer tools. Should you still need/want to use them, there are alternative ways to do so.

### React Developer Tools

This set of developer tools can be used as a separate application. To run it, use:

```
npx react-devtools
```

This will install the application (if necessary) and run it. Afterwards it will wait for a
connection from our Electon app. To make our app connect, you need to set the `SB_REACT_DEV`
environment variable. On Windows this can be done by running:

```
set SB_REACT_DEV=1
```

Any instances of our app launched from that terminal will then connect to the remote devtools.

### Redux Developer Tools

This set of developer tools are manually integrated into our application, instead of using a browser
extension as it was done previously. To show/hide it, use the following hotkey inside application:

```
ctrl + h
```

To change the default position of the overlay, use the following hotkey:

```
ctrl + q
```

### Jotai Developer Tools

This is controlled via a floating button in the bottom left of the screen. By default it is not
visible, but it can be toggled via the hotkey:

```
ctrl + i
```

This will toggle visibility of the entire UI (so if you have the panel open, you can toggle it
on/off without losing its state).

## Simulating Bad Network Conditions

The game's netcode normally binds an ephemeral local UDP port, which makes it hard to aim a
traffic-shaping tool at one specific client when several are running on the same machine. To pin
the port to a known value, set the `SB_RALLY_POINT_PORT` environment variable before launching the
app:

```
set SB_RALLY_POINT_PORT=14899
```

Any game launched by an app instance from that terminal will bind its netcode endpoint to that
local UDP port, so a tool that filters by port (e.g. [clumsy](https://jagt.github.io/clumsy/)) can
target just that client — for example with the clumsy filter `udp.SrcPort == 14899 or
udp.DstPort == 14899`. Give each client its own port (via separate terminals) to shape them
independently.

If the pinned port can't be bound (say another client already holds it), the game logs a warning
and falls back to an ephemeral port rather than failing the launch — check the game log if your
filter doesn't seem to match any traffic.
