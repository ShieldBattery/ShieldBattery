#!/usr/bin/env bash
# Builds the game DLL for both architectures with the bench-dll profile (release optimizations plus
# the debug-only rollback tooling the soak needs) and pins copies, with the files the DLL loads from
# beside itself, into a directory the soak injects from via SB_GAME_DLL_DIR. A later build.bat in
# the checkout can't change the DLL under a running soak.
#
# usage: pin-dlls.sh [dir]   (default: .claude-scratch/rollback-soak/dll)
set -eu
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT=${1:-$ROOT/.claude-scratch/rollback-soak/dll}
mkdir -p "$OUT"
cd "$ROOT/game"
cargo build --target x86_64-pc-windows-msvc --profile bench-dll
cargo build --target i686-pc-windows-msvc --profile bench-dll
T=$ROOT/game/target
cp "$T/x86_64-pc-windows-msvc/bench-dll/shieldbattery.dll" "$OUT/shieldbattery_64.dll"
cp "$T/x86_64-pc-windows-msvc/bench-dll/shieldbattery.pdb" "$OUT/shieldbattery_64.pdb"
cp "$T/i686-pc-windows-msvc/bench-dll/shieldbattery.dll" "$OUT/shieldbattery.dll"
cp "$T/i686-pc-windows-msvc/bench-dll/shieldbattery.pdb" "$OUT/shieldbattery.pdb"
D=$ROOT/game/dist
cp "$D/sb_init.dll" "$D/sb_init_64.dll" "$D/d3dcompiler_47.dll" "$OUT/"
cp -r "$D/fonts" "$OUT/"
echo "pinned to $OUT"
