# Preview backdrops

Drop a 16:9 StarCraft: Remastered gameplay screenshot here as `gameplay-1080.png` (any 16:9
size; 2560×1440 or 1920×1080 captures work well) and the overlay preview draws every scenario
over it by default, so panels are judged against the scene they have to stay readable on. The
file is read at startup, not embedded, and is not tracked in git; without it the preview uses a
solid dark fill. `--backdrop <path>` or the backdrop knob selects a different image.
