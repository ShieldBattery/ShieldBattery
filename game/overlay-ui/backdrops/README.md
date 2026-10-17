# Preview backdrops

Any 16:9 StarCraft: Remastered gameplay screenshot dropped here as a `.png` becomes the overlay
preview's default backdrop, so panels are judged against the scene they have to stay readable on.
The preview takes the first `.png` in name order (so `gameplay-1440.png` is the one in use; add a
name that sorts earlier to override it), reads it at startup rather than embedding it, and falls
back to a solid dark fill when the directory holds none. `--backdrop <path>` or the backdrop knob
selects a different image. The captures are tracked in git so every developer sees the same
scene.
