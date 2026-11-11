#!/usr/bin/env python3
"""Verifies the BWAPI 4.4 mapping ABI from independent MSVC and Rust probes."""
import argparse
import json
from pathlib import Path

EXPECTED_CLIENT_VERSION = "const int CLIENT_VERSION = 10003"
C_TO_RUST = {
    "BWAPI::GameInstance": "GameInstance",
    "BWAPI::GameTable": "GameTable",
    "BWAPI::ForceData": "ForceData",
    "BWAPI::PlayerData": "PlayerData",
    "BWAPI::UnitData": "UnitData",
    "BWAPI::BulletData": "BulletData",
    "BWAPI::RegionData": "RegionData",
    "BWAPIC::Event": "Event",
    "BWAPIC::Shape": "Shape",
    "BWAPIC::Command": "Command",
    "BWAPIC::UnitCommand": "UnitCommand",
    "BWAPI::unitFinder": "UnitFinder",
    "BWAPI::GameData": "GameData",
    "BWAPI::GameData.client_version": "GameData.client_version",
    "BWAPI::GameData.players": "GameData.players",
    "BWAPI::GameData.units": "GameData.units",
    "BWAPI::GameData.isWalkable": "GameData.is_walkable",
    "BWAPI::GameData.events": "GameData.events",
    "BWAPI::GameData.strings": "GameData.strings",
    "BWAPI::GameData.commands": "GameData.commands",
    "BWAPI::GameData.unitCommands": "GameData.unit_commands",
}


def load(path: Path) -> dict[str, int]:
    data = path.read_bytes()
    if data.startswith(bytes((255, 254))):
        return json.loads(data.decode('utf-16'))
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bwapi-root", type=Path, required=True)
    parser.add_argument("--cpp-x64", type=Path, required=True)
    parser.add_argument("--cpp-x86", type=Path, required=True)
    parser.add_argument("--rust-x64", type=Path, required=True)
    parser.add_argument("--rust-x86", type=Path, required=True)
    args = parser.parse_args()

    header = args.bwapi_root / "bwapi" / "include" / "BWAPI.h"
    if EXPECTED_CLIENT_VERSION not in header.read_text(encoding="utf-8"):
        raise SystemExit(f"{header} is not BWAPI 4.4.0")
    cpp_x64, cpp_x86 = load(args.cpp_x64), load(args.cpp_x86)
    rust_x64, rust_x86 = load(args.rust_x64), load(args.rust_x86)
    if cpp_x64 != cpp_x86 or rust_x64 != rust_x86:
        raise SystemExit("the BWAPI wire ABI differs by architecture")
    for cpp_key, rust_key in C_TO_RUST.items():
        if cpp_x64[cpp_key] != rust_x64[rust_key]:
            raise SystemExit(f"ABI mismatch: {cpp_key}={cpp_x64[cpp_key]}, {rust_key}={rust_x64[rust_key]}")
    print("BWAPI 4.4 C++ and Rust ABI layouts match on x86 and x64.")


if __name__ == "__main__":
    main()
