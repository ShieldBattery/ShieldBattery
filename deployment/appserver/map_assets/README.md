After uploading the `deployment` files to a server, put StarCraft: Remastered's SD assets in this
folder. `server_rs` uses them to render map images and analyze map terrain. They're fetched from
Blizzard's CDN with broodmap's CLI:

```
cargo install --git https://github.com/ShieldBattery/broodmap broodmap-cli
broodmap-cli fetch-assets --cdn --out <this folder>
```

See the [map system documentation](../../docs/GETTING_STARTED.md#set-up-map-system) for more
details. Without these assets, uploaded maps get no images.
