# Native launcher ownership

The pnpm patch applies to the integrity-pinned `@shieldbattery/stimpack` 1.1.1 source.
It adds a per-launch cancellation owner and termination through the process handle
returned by `CreateProcessW`. Cancellation before handle creation rejects the late
process while it is still suspended. Existing injector source and MIT notices stay
in the dependency; no compiled binary is committed or downloaded from a fork.

On Windows, the app prebuild compiles this patched source with the Rust x64 MSVC
toolchain before bundling. This module launches both x86 and x64 games; Electron
itself is x64. Normal source installation uses the frozen app lockfile and applies
the patch through pnpm. Building the app main process now also requires Rust/MSVC.
Release companion and signing requirements still apply.

From a Windows developer shell at the repository root:

```sh
node tools/build-native-launcher.mjs
node tools/build-native-launcher.mjs --test
node tools/build-native-launcher.mjs --check
```

The native tests launch disposable copies of their test executable. They verify
that a hung owned process exits, an unrelated process of the same image survives,
repeated termination is safe, and a late process cannot bind to a cancelled owner.
The ignored `hung_fixture` test is a subprocess target and must not run directly.

The patch also makes four small compiler/lint compatibility adjustments needed
to check the pinned source with the current Rust toolchain. Replace this patch
with an upstream dependency update when the ownership API is available there.
