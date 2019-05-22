## Game DLL structure

The code of the game DLL has two major parts: asynchronous code that focuses on handling
network traffic, and 'synchronous' code that executes inside of hooks into BW's code.
They currently are mixed in `src/` directory, but it may be worth separating one/both of them in
separate modules, even though most of the files aren't 100% async or 100% BW.

### Async
The async code handles communication with the app and other players, and as such contains most
of our logic. The effective entry point for async code is `async_thread` in `lib.rs`, and the
following files contain rest of the async side:

- `app_messages.rs` Definitions for messages sent to/from app, and helper code for parsing them.
- `app_socket.rs` Task for handling the websocket connection to the ShieldBattery app.
- `cancel_token.rs` Helper code for cleaning up tasks when their parent gets dropped.
- `game_state.rs` The most complex part of this DLL, manages game initialization. It may
    handle other game-related async functionality in future, but right now we don't have any :)
    The rest of the async code avoids directly calling BW functions at all
    (as the BW thread is doing its own thing simultaneously, which could be bad),
    but we do it in `GameState::init_game` as the older C++/JS code worked the same, and during
    game initialization the BW thread is set to run windows message loop via forge.
    It is a bit sketchy and hard to follow anyway.
- `network_manager.rs` Links the rally-point and BW sides together, and reports results to
    GameState
- `rally_point.rs` Implementation of rally-point-player in Rust.
- `udp.rs` Custom async UDP implementation since the existing ones were bad. Hacky and does not scale,
    but works fine since we only need a single UDP socket for rally-point.

`async_thread` has another comment describing relations of these parts.
For details on the libraries/other terms used with this async code, see [documentation for the Tokio
library](https://tokio.rs/docs/overview/). Note that the Future API is changing from the current
'futures 0.1', and the code should be updated to it likely some time later this year, depending
how the necessary libraries become available.

A common pattern that the async modules use to handle their mutable state is to have a task
that takes input messages over a channel and updates the state based on those messages. The public
API is just a struct that is able to send those messages, usually the messages contain a reply
channel which receives the result. E.g. in `rally_point.rs`, `struct RallyPoint` is just a structure
which sends messages (`ExternalMessage`) to the task started in `fn init()` with internal state
`struct State`. If the task itself needs to run some async code and update state based on that,
it will need to spawn a child task which sends an state-updating message back to parent once it
has the necessary result (`Request::{ServerMessage, CleanupJoin, CleanupPing}` in `rally_point`
are messages which update the state but are only sent from the task itself).

When there's no need to update such long-lived mutable state, the async code can be written
just as a chain of `and_then` futures (in future they should be convertible easily to `await`s),
which is pretty easy to follow.
On the other hand, the horrifying `fn init_game` in `game_state.rs` creates a task which, while
mostly still sequence of futures without state updating, has three futures (`wait_for_players()`,
`wait_for_results()`, `wait_network_ready()`) which become ready based on state updating based on
multiple events, and as such the relevant code for them is found outside `init_game` function.
It's tougher to follow, even though technically BW still has pretty strict sequence how
the initialization plays out :/

### BW
We mostly let BW do its own thing, and intercept it with hooks, possibly sending messages to
async side from those hooks. Hooks are initialized in `patch_game` in `lib.rs`.
The following files contain BW-side code:

- `bw.rs` Function/hook/global/structure definitions for BW 1.16.1
- `chat.rs` Chat handling, async side can also set the settings for this
- `game_thread.rs` Code for running functions in BW thread based on requests from async side.
    Entry point is `run_event_loop`, though the `StartGame` request will prevent any further
    requests until game ends, so it's practically just for running code during initialization.
    Even there we're blocked on forge window loop a lot.
- `forge/` D3D11 based renderer and WIN32/DirectDraw hooks.
    Mostly meant to have minimal dependencies on the parent code.
- `lib.rs` Early initialization before async thread/misc common code.
- `observing.rs` Hooks that make observing work.
- `snp.rs` Storm Network Provider, practically non-async network code.
- `storm.rs` Helper code for calling the few Storm functions we use.
- `windows.rs` Miscellaneous helper functions for calling Windows APIs. Though usually it is not
    worth it to wrap every one-off Winapi function in a nicer interface.
