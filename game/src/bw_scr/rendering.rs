//! Renderer, shader, and overlay hooks.

use std::ffi::c_void;
use std::ptr::{NonNull, null, null_mut};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

use crate::app_messages::StartingFog;
use crate::bw::{Bw, get_bw};
use crate::bw_scr::draw_inject::warn_once;
use crate::game_thread;
use crate::netcode_v2;

use super::{
    BwScr, SHADER_ID_MASK, draw_inject, draw_overlay, fog_style, image_load_pump,
    is_minimap_mask_draw, replay_save, save_observer_panels, scr,
};

impl BwScr {
    pub(super) unsafe fn rendering_patches(
        &'static self,
        exe: &mut whack::ModulePatcher<'_>,
        base: usize,
    ) {
        unsafe {
            use super::hooks::*;
            let renderer_vtable = self.prism_renderer_vtable.0 as *const scr::V_Renderer;

            let draw = (*renderer_vtable).draw;
            let swap_buffers = (*renderer_vtable).swap_buffers;
            let create_shader = (*renderer_vtable).create_shader;

            if let Some(cursor) = &self.software_cursor {
                let address = cursor.draw.0 as usize - base;
                let push_mode_override = cursor.push_mode_override;
                let pop_mode_override = cursor.pop_mode_override;
                // Everything the cursor queues takes the overridden layer, which also picks the
                // render target it goes to: the backbuffer, over the overlay.
                exe.hook_closure_address(
                    DrawSoftwareCursor,
                    move |orig| {
                        let commands = self.draw_commands.resolve();
                        let first = (*commands).draw_command_count;
                        push_mode_override(draw_overlay::SOFTWARE_CURSOR_DRAW_LAYER);
                        orig();
                        pop_mode_override();
                        let end = (*commands).draw_command_count;
                        self.software_cursor_draw_commands
                            .0
                            .store(u32::from(first), Ordering::Relaxed);
                        self.software_cursor_draw_commands
                            .1
                            .store(u32::from(end), Ordering::Relaxed);
                    },
                    address,
                );
            }

            let address = self.draw_graphic_layers.0 as usize - base;
            // draw_graphic_layers is the main BW draw command queuing function.
            // Usually called once per render to queue DrawCommands for all sprites of the game
            // as well as UI, but when the user is in middle of switching between
            // SD and HD, it will be called a second time with `second_draw == 1`
            // so that the game will be able to fade between the two graphic modes.
            exe.hook_closure_address(
                DrawGraphicLayers,
                move |extra_funcs, extra_func_len, second_draw, orig| {
                    let _timing = crate::frame_timing::draw(second_draw == 0);
                    let _pacing = crate::frame_pacing::draw();
                    // Detect a Shift+Tab color-mode cycle before queuing draws, so this frame renders
                    // with the corrected mode/colors. A no-op unless custom team colors are active.
                    // Only on the primary pass; the SD/HD-fade second pass sees the same global.
                    if second_draw == 0 {
                        self.poll_team_color_mode();
                    }
                    // `extra_funcs` holds the game's per-frame HUD update, which must run whether
                    // or not the console is shown: it expires chat lines and cycles palettes
                    // among other things. A hidden console's art is held back by the hook on its
                    // own draw entry instead (see `Console_Draw`), and its interactable parts are
                    // dialogs, hidden separately. Its tooltip is the one thing it can turn on that
                    // neither of those covers, so a callback after it hides that again.
                    let graphic_layers =
                        self.graphic_layers.and_then(|x| NonNull::new(x.resolve()));
                    let callbacks = with_tooltip_layer_hider(extra_funcs, extra_func_len);
                    orig(
                        callbacks.as_ptr() as *mut c_void,
                        callbacks.len(),
                        second_draw,
                    );
                    let renderer = self.renderer.resolve();
                    let commands = self.draw_commands.resolve();
                    let vertex_buffer = self.vertex_buffer.resolve();
                    let players = self.players();
                    let game = self.game();
                    if game.is_null() {
                        // Early screen draw
                        return;
                    }
                    let game = bw_dat::Game::from_ptr(game);
                    let has_init_bw = game_thread::HAS_INIT_BW.load(Ordering::Acquire);
                    let game_started = self.game_started.load(Ordering::Acquire)
                        && !self.init_uploads_settling.load(Ordering::Acquire);
                    let is_replay_or_obs = self.is_replay_or_obs();
                    let is_replay = self.is_replay.resolve() != 0;
                    let is_shared_control = game_thread::is_shared_control();
                    let alliance_rules = self.alliance_rules();
                    let pause_control = self.pause_control(game, is_replay);
                    let main_palette = self.main_palette.resolve();
                    let rgb_colors = self.rgb_colors.resolve();
                    let use_rgb_colors = self.use_rgb_colors.resolve();
                    let statres_icons = self.statres_icons.resolve();
                    let cmdicons = self.cmdicons.resolve();
                    let wirefram = self.wirefram.map_or(null_mut(), |x| x.resolve());
                    let replay_visions = self.replay_visions.resolve();
                    let local_player_id = self.local_unique_player_id.resolve() as u8;
                    // The header is only a replay's, and it is only populated once one is running.
                    let replay = is_replay
                        .then(|| self.replay_header())
                        .filter(|header| !header.is_null())
                        .map(|header| draw_overlay::ReplayVars {
                            end_frame: (*header).replay_end_frame,
                            game_speed: (*header).game_info.game_speed,
                            playback: self.replay_playback_state(),
                        });
                    let active_units = self.active_units();
                    // The whole unit array, which is what a unique id (as the loaded-unit slots of
                    // a transport hold) has to be looked up in. Null until the game allocates it.
                    let units = self.unit_array();
                    let client_selection = self.client_selection();
                    let first_player_unit = self.first_player_unit.resolve();
                    // Assuming that the last added draw command (Added during orig() call)
                    // will have the is_hd value that is currently being used.
                    // Could also probably examine the render target from get_render_target,
                    // as that changes depending on if BW is currently rendering HD or not.
                    let is_hd = if second_draw == 0 {
                        (*commands)
                            .draw_command_count
                            .checked_sub(1)
                            .and_then(|idx| (*commands).commands.get(idx as usize))
                            .map(|x| x.is_hd != 0)
                            .unwrap_or_else(|| {
                                // Fallback: Use what previous frame had during render
                                self.is_hd_mode[0].load(Ordering::Relaxed)
                            })
                    } else {
                        // Always use previous frame's info for second draw, as we'd have to track
                        // if the previous draw command was added by us (BW adding nothing) or not
                        // otherwise.
                        self.is_hd_mode[1].load(Ordering::Relaxed)
                    };
                    // Followed only once the game runs: what the loading screen draws in says
                    // nothing about the player's settings.
                    let mut engine_setting_changes = Vec::new();
                    if second_draw == 0 {
                        self.last_overlay_hd_value.store(is_hd, Ordering::Relaxed);
                        if game_started {
                            engine_setting_changes = self.follow_engine_settings();
                        }
                        self.refresh_stale_game_stats();
                        if game_started {
                            // The simulation steps follow alliance changes as they happen, but a
                            // replay seek that lands paused can move the game to other alliances
                            // without a step.
                            self.update_team_colors_from_alliances();
                        }
                    }
                    // SC:R only enables carbot if both of these flags are set
                    let is_carbot = self.is_carbot.load(Ordering::Relaxed)
                        && self.show_skins.load(Ordering::Relaxed);
                    // The overlay draws to the backbuffer (render target 0), at the window's own
                    // resolution; its one surface among the game's UI layers goes to their target, 1.
                    // A second pass of this hook is the other graphics mode's while SD and HD fade
                    // into each other, and draws to its own UI target; the backbuffer is shared, so
                    // the overlay is drawn by the first pass alone.
                    if second_draw != 0 {
                        return;
                    }
                    let ui_target = (self.get_render_target)(1);
                    let backbuffer = (self.get_render_target)(0);
                    let is_dx9_renderer = self
                        .dx9_renderer_vtables
                        .iter()
                        .any(|vtable| vtable.0 as *const scr::V_Renderer == (*renderer).vtable);
                    // Only SC:R's Prism renderer lets the overlay's draws reach the backbuffer.
                    // The legacy renderers (DX9, and OpenGL, which SC:R falls back to when Prism
                    // finds no GPU, as under Wine) only let draws that take their default outputs
                    // reach it, and the overlay's shader names its outputs. There the overlay
                    // draws to the UI target at that target's resolution, and the game's final
                    // pass scales it onto the backbuffer. The backbuffer's backend target can't
                    // tell the renderers apart, being null under Prism's DX11 as well.
                    let backbuffer_drawable = (*renderer).vtable
                        == self.prism_renderer_vtable.0 as *const scr::V_Renderer;
                    let render_target = if backbuffer_drawable {
                        draw_inject::RenderTarget::backbuffer(backbuffer, ui_target)
                    } else {
                        warn_once!(
                            "The overlay draws to the UI target, as the renderer isn't Prism \
                             (DX9 renderer: {is_dx9_renderer})"
                        );
                        draw_inject::RenderTarget::whole(ui_target, 1)
                    };
                    let ui_render_target =
                        draw_inject::RenderTarget::sharing_points(ui_target, 1, &render_target);
                    if let Some(mut render_state) = self.render_state.lock() {
                        let countdown_start = *self.countdown_start.lock();
                        let apm_guard = self.apm_state.lock();
                        let apm = apm_guard.as_deref();
                        // The simulation step that fills this has returned by the time a frame is
                        // drawn, so the lock is never contended; `None` here is a re-entrant draw,
                        // which reports the game as it was before its first second.
                        let game_stats_guard = self.game_stats.lock();
                        let game_stats = game_stats_guard.as_deref();
                        let size = render_target.size();
                        // A snapshot of who has lost connection, for the survivor overlay. `None`
                        // (a replay, or a re-entrant lock) renders as an all-healthy status.
                        let disconnect_status =
                            netcode_v2::with_turn_state(|s| s.disconnect_status())
                                .unwrap_or_else(netcode_v2::DisconnectStatus::healthy);
                        // A snapshot of the network-stats overlay, or `None` when it is toggled off
                        // (or there is no session). Safe to reach the turn state here: the draw path
                        // holds no turn-state lock across `step`.
                        let net_stats =
                            netcode_v2::with_turn_state(|s| s.net_stats_status(Instant::now()))
                                .flatten();
                        // What the panel adds for a game that rolls back. Read only while it is
                        // up, and outside the turn state's lock, which this takes itself.
                        let net_rollback = net_stats
                            .is_some()
                            .then(crate::rollback_live::net_status)
                            .flatten();
                        let net_quality = self.net_quality_view();
                        // Who has connected so far, for the loading screen. `None` before this
                        // client's own session is up, and not needed once the game has started.
                        let loading_connectivity = if game_started {
                            None
                        } else {
                            netcode_v2::with_turn_state(|s| s.loading_connectivity())
                        };
                        // If we're switching between SD/HD, egui flexboxes will break due
                        // to render target size constantly changing, so we allow the overlay
                        // to request a second pass to provide nicer look.
                        // This means we do 4 passes per frame while changing graphics quality,
                        // but the performance should not be that bad..
                        // Read out of the game's storage here rather than at setup: the draw is on
                        // the main thread, and by now the storage is open.
                        if render_state.overlay.needs_resource_icons() {
                            render_state
                                .overlay
                                .load_resource_icons(|path| self.read_game_file(path));
                        }
                        let wireframe_remap = *self.wireframe_remap.get_or_init(|| {
                            draw_overlay::WireframeRemap::load(|path| self.read_game_file(path))
                        });
                        for &change in &engine_setting_changes {
                            render_state.overlay.setting_changed_in_game(change);
                        }
                        // Every frame rather than once: the game can switch languages from its
                        // options while running.
                        overlay_ui::i18n::set_locale(self.overlay_locale());
                        for _ in 0..2 {
                            let overlay_out = render_state.overlay.step(
                                &draw_overlay::BwVars {
                                    is_replay_or_obs,
                                    is_replay,
                                    is_shared_control,
                                    game,
                                    players,
                                    main_palette,
                                    rgb_colors,
                                    use_rgb_colors,
                                    replay_visions,
                                    active_units,
                                    units,
                                    client_selection,
                                    first_player_unit,
                                    dialogs: self.dialogs(),
                                    graphic_layers,
                                    is_hd,
                                    is_carbot,
                                    cmdicons,
                                    wirefram,
                                    wireframe_remap,
                                    has_init_bw,
                                    image_load_progress: image_load_pump::progress(),
                                    countdown_start,
                                    game_started,
                                    local_player_id,
                                    replay,
                                    stat_txt: self.stat_txt,
                                    alliance_rules,
                                    pause_control,
                                    map_view: draw_overlay::MapView {
                                        left: self.screen_x.resolve(),
                                        top: self.screen_y.resolve(),
                                        width: self.game_screen_width_bwpx.resolve(),
                                        height: self.game_screen_height_bwpx.resolve(),
                                    },
                                },
                                apm,
                                game_stats,
                                size,
                                game_thread::setup_info(),
                                &disconnect_status,
                                net_stats.as_ref(),
                                net_rollback.as_ref(),
                                net_quality.as_ref(),
                                loading_connectivity.as_ref(),
                                &self.chat_history,
                                &self.chat_manager,
                                &self.options,
                                &self.option_lists,
                                &self.observer_panels,
                            );
                            if cfg!(debug_assertions) {
                                self.handle_debug_ui_actions(&overlay_out, &mut render_state);
                            }
                            if replay_visions != overlay_out.replay_visions {
                                self.note_replay_vision_choice(
                                    replay_visions,
                                    overlay_out.replay_visions,
                                );
                                self.write_replay_visions(overlay_out.replay_visions);
                                // Has to be called here or otherwise there's minimap flicker
                                // with the resources disappearing until the game logic moves
                                // forward a step.
                                game_thread::add_fow_sprites_for_replay_vision_change(self);
                            }
                            if overlay_out.leave_game {
                                // What the in-game menu's End Game does: the step loop exits
                                // once it sees the flag, and a stalled step lets it go too (see
                                // `end_session_for_requested_exit`).
                                self.netcode_v2.continue_game_loop.write(0);
                            }
                            if let Some(unit) = overlay_out.select_unit {
                                let units = [*unit];
                                (self.selection.select_units)(units.len(), units.as_ptr(), 1, 0);
                                self.center_screen(&unit.position());
                            }
                            if let Some(point) = overlay_out.look_at {
                                self.center_screen(&point);
                            }
                            // The sound SC:R's own in-game buttons make when they are pressed.
                            if overlay_out.button_click {
                                self.play_sound("SND_BUTTON");
                            }
                            // The game's own way of emptying a selection, the one it takes when
                            // the last selected unit dies.
                            if overlay_out.clear_selection {
                                (self.selection.select_units)(0, std::ptr::null(), 0, 0);
                            }
                            if let Some(group) = &overlay_out.select_group {
                                let units =
                                    group.units.iter().map(|unit| **unit).collect::<Vec<_>>();
                                (self.selection.select_units)(units.len(), units.as_ptr(), 1, 0);
                                if group.center {
                                    self.center_screen(&group.units[0].position());
                                }
                            }
                            self.set_bottom_overpan(overlay_out.bottom_overpan_share);
                            // After everything else that moves the view this frame, which ends
                            // a follow rather than being undone by it.
                            self.follow_unit(overlay_out.follow_unit);
                            // Only once the game runs: before then there is no game view to
                            // resize, and the map load ahead resets its height anyway.
                            // Read after the step, which can have closed and spawned dialogs.
                            let first_dialog = self.resolve_first_dialog();
                            let console_shown = !self.console_hidden();
                            if game_started
                                && (overlay_out.console_visible != console_shown
                                    || (!overlay_out.console_visible
                                        && self.console_space_returned()))
                            {
                                self.set_console_visible(first_dialog, overlay_out.console_visible);
                            }
                            let minimap_shown = !self.minimap_hidden();
                            if overlay_out.minimap_visible != minimap_shown {
                                self.set_minimap_visible(first_dialog, overlay_out.minimap_visible);
                            }
                            // After the console, whose own visibility this one is bounded by.
                            let command_panel_shown = !self.command_panel_hidden();
                            if overlay_out.command_panel_visible != command_panel_shown {
                                self.set_command_panel_visible(
                                    first_dialog,
                                    overlay_out.command_panel_visible,
                                );
                            }
                            for command in &overlay_out.replay_commands {
                                self.send_replay_command(*command);
                            }
                            for command in &overlay_out.game_commands {
                                (self.send_command)(command.as_ptr(), command.len());
                            }
                            if !overlay_out.setting_changes.is_empty() {
                                self.apply_setting_changes(&overlay_out.setting_changes);
                            }
                            if let Some(panels) = overlay_out.observer_panels_changed {
                                save_observer_panels(panels);
                            }
                            let bw = &draw_inject::BwVars {
                                renderer,
                                commands,
                                vertex_buf: vertex_buffer,
                                is_hd,
                                is_carbot,
                                statres_icons,
                                cmdicons,
                                wirefram,
                                vertex_colors_bgra: is_dx9_renderer,
                            };
                            if overlay_out.run_second_draw {
                                draw_inject::update_textures_without_adding_overlays(
                                    &mut render_state.render,
                                    bw,
                                    overlay_out,
                                );
                            } else {
                                let first = (*commands).draw_command_count;
                                draw_inject::add_overlays(
                                    &mut render_state.render,
                                    bw,
                                    overlay_out,
                                    backbuffer_drawable.then_some(&render_target),
                                    &ui_render_target,
                                );
                                let end = (*commands).draw_command_count;
                                self.overlay_draw_commands
                                    .0
                                    .store(u32::from(first), Ordering::Relaxed);
                                self.overlay_draw_commands
                                    .1
                                    .store(u32::from(end), Ordering::Relaxed);
                                break;
                            }
                        }
                    }
                },
                address,
            );
            // Minimap-only team colors: while the feature is active in that mode, swap the engine's
            // assignment into `rgb_colors` for the span of each minimap dot draw and restore the
            // previous contents afterward, so the dots recolor without touching unit colors. The
            // dispatcher draws the local player and lone sprites inline and calls the two per-player
            // helpers for everyone else, so the guards nest (see `begin_minimap_team_colors`). Full
            // cdecl overrides; each falls through to `orig` untouched in any other mode. Installed
            // only when all three sites resolved; otherwise that mode stays on BW's diplomacy dots.
            if let Some(minimap_hooks) = self.minimap_draw_hooks.as_ref() {
                let address = minimap_hooks.draw_minimap_units.0 as usize - base;
                exe.hook_closure_address(
                    DrawMinimapUnits,
                    move |orig| {
                        // A Shift+Tab press earlier in this frame has already moved the real
                        // color-mode global, but the layer-draw poll runs after the minimap is
                        // drawn — detect the cycle here first so this frame's dots don't render
                        // one mode behind (a one-frame wrong-palette flash). Must happen before
                        // the swap guard exists: applying a mode change writes `rgb_colors`, and
                        // a guard restore after that would clobber it.
                        self.poll_team_color_mode();
                        let _swap = self.begin_minimap_team_colors();
                        orig();
                    },
                    address,
                );
                let address = minimap_hooks.draw_minimap_player_units.0 as usize - base;
                exe.hook_closure_address(
                    DrawMinimapPlayerUnits,
                    move |player, orig| {
                        let _swap = self.begin_minimap_team_colors();
                        orig(player);
                    },
                    address,
                );
                let address = minimap_hooks.draw_minimap_main_player_units.0 as usize - base;
                exe.hook_closure_address(
                    DrawMinimapMainPlayerUnits,
                    move |player, orig| {
                        let _swap = self.begin_minimap_team_colors();
                        orig(player);
                    },
                    address,
                );
            }
            // SC:R moves the minimap into the bottom-left corner when the minimap position setting
            // asks for it, or when its observer UI does, which it always does for watchers. The
            // InitObsUi hook keeps that observer UI from being made, so the corner is asked for
            // here instead. SC:R reapplies the offset on resizes and SD/HD switches, through here.
            if let Some(update_offset) = self.update_minimap_dialog_horizontal_offset {
                let address = update_offset.0 as usize - base;
                exe.hook_closure_address(
                    UpdateMinimapDialogHorizontalOffset,
                    move |expand, orig| {
                        let watching = self.is_replay_or_obs()
                            || self.obs_ui_init_as_player.load(Ordering::Relaxed);
                        orig(if watching { 1 } else { expand });
                    },
                    address,
                );
            }
            // Units owned by a high player id (the neutral player and the unused ids next to it) are
            // tinted from the palette rather than `rgb_colors`, so the scheme's neutral color has
            // to be handed out here for the game view to show it.
            if let Some(get_player_color) = self.get_player_color {
                let address = get_player_color.0 as usize - base;
                exe.hook_closure_address(
                    GetPlayerColor,
                    move |out, player, orig| match self.neutral_unit_color_override(player as u8) {
                        Some(color) => {
                            *out = color;
                            out
                        }
                        None => orig(out, player),
                    },
                    address,
                );
            }
            // SC:R's own lookup asserts that the tileset color-cycling table is non-null and then
            // reads through the pointer regardless, so any UI built while no terrain is loaded —
            // between the terrain being freed and the next menu or map load — faults on the null
            // table. Return a palette index without consulting the table in that window instead.
            if let Some(lookup) = self.palette_color_lookup.as_ref() {
                let address = lookup.find_nearest_palette_color.0 as usize - base;
                exe.hook_closure_address(
                    FindNearestPaletteColor,
                    move |palette, color, orig| {
                        if lookup.is_cycling_color_table.resolve().is_null() {
                            warn_once!(
                                "Nearest palette color was looked up without a loaded tileset"
                            );
                            return 0;
                        }
                        orig(palette, color)
                    },
                    address,
                );
            }

            // SC:R autosaves the replay from inside the multiplayer game teardown and replaces the
            // existing file without clearing a read-only attribute, then reports a failed replace
            // with a modal dialog. Clear the file out of the way here and log a failure instead.
            if let Some(autosave) = self.replay_autosave.as_ref() {
                let address = autosave.save_replay_by_name.0 as usize - base;
                exe.hook_closure_address(
                    SaveReplayByName,
                    move |name, replace_existing, orig| {
                        // After this autosave, the teardown files a copy of it away and, depending
                        // on Battle.net state, reloads that copy's metadata. The reload empties the
                        // recording and zeroes the replay header (leaving it zeroed when the
                        // reload fails), all before the game loop returns. Reporting the result
                        // saves the upload replay, so it has to happen here while the recording is
                        // still this game's. A no-op if the result was already reported.
                        game_thread::send_game_results();
                        replay_save::sanitize_recording(
                            self.replay_data(),
                            (*self.game()).frame_count,
                            self.game_command_lengths(),
                        );
                        replay_save::save_replay_by_name_hook(
                            autosave,
                            name,
                            replace_existing,
                            orig,
                        )
                    },
                    address,
                );
            }

            // Render hook
            let relative = draw.cast_usize() - base;
            exe.hook_closure_address(
                Renderer_Render,
                move |renderer, commands, width, height, orig| {
                    crate::frame_pacing::render_started();
                    let draw_command_count = (*commands).draw_command_count as usize;

                    // Update is_hd value based on what BW output to final render target draw
                    // (Can have two values when doing the transfer between SD/HD)
                    let mut n = 0;
                    let take = |span: &(AtomicU32, AtomicU32)| {
                        span.0.swap(0, Ordering::Relaxed) as usize
                            ..span.1.swap(0, Ordering::Relaxed) as usize
                    };
                    let overlay = take(&self.overlay_draw_commands);
                    let cursor = take(&self.software_cursor_draw_commands);
                    for i in 0..draw_command_count {
                        let cmd = &raw mut (*commands).commands[i];
                        if (*cmd).render_target_id == 0
                            && !overlay.contains(&i)
                            && !cursor.contains(&i)
                        {
                            self.is_hd_mode[n].store((*cmd).is_hd != 0, Ordering::Relaxed);
                            n += 1;
                            if n == 2 {
                                break;
                            }
                        }
                    }
                    self.hd_switching.store(n == 2, Ordering::Relaxed);
                    if n == 1 {
                        // n == 1 should mean that no SD/HD transfers were active this frame.

                        // Set the other just opposite of what the first one was if it isn't
                        // currently used. Will be a good guess if second draw gets used next
                        // frame.
                        let main_hd_mode = self.is_hd_mode[0].load(Ordering::Relaxed);
                        self.is_hd_mode[1].store(!main_hd_mode, Ordering::Relaxed);
                        // On the other hand, if SD/HD switch just finished, this is first
                        // frame where second draw doesn't get used and main_hd_mode is
                        // opposite of what it was previous frame.
                        // This means that overlay code may have added wrong draw commands,
                        // which have to be fixed now to prevent a single black frame flickering.
                        if self.last_overlay_hd_value.load(Ordering::Relaxed) != main_hd_mode {
                            for i in 0..draw_command_count {
                                let cmd = &raw mut (*commands).commands[i];
                                (*cmd).is_hd = main_hd_mode as u32;
                            }
                        }
                    }
                    if self.shader_replaces.has_changed() {
                        // Hot reload shaders.
                        // Unfortunately repatching the .exe to replace shader sets in BW
                        // memory is not currently possible.
                        // Will have to write over the previously allocated scr::PrismShader slice
                        // instead.
                        for (id, new_set) in self.shader_replaces.iter_shaders() {
                            if let Some(shader_set) = self.prism_pixel_shaders.get(id as usize) {
                                let shader_set = shader_set.0 as usize as *mut scr::PrismShaderSet;
                                assert_eq!((*shader_set).count as usize, new_set.len());
                                let out = std::slice::from_raw_parts_mut(
                                    (*shader_set).shaders,
                                    (*shader_set).count as usize,
                                );
                                if out[0].data != new_set[0].data {
                                    out.copy_from_slice(new_set);
                                    let args = {
                                        let renderer_state = self.renderer_state.lock();
                                        renderer_state.shader_inputs.get(id as usize).copied()
                                    };
                                    if let Some(args) = args {
                                        create_shader.call6(
                                            renderer,
                                            args.shader,
                                            null(),
                                            args.vertex_path,
                                            args.pixel_path,
                                            null_mut(),
                                        );
                                    }
                                }
                            }
                        }
                    }

                    let show_network_stalled =
                        if self.visualize_network_stalls.load(Ordering::Relaxed)
                            && !self.is_network_ready()
                        {
                            1.0
                        } else {
                            0.0
                        };

                    // Leave unexplored area in UMS maps black
                    let use_new_mask = if crate::game_thread::is_ums()
                        || self.starting_fog.load(Ordering::Relaxed) != StartingFog::Transparent
                    {
                        0.0
                    } else {
                        1.0
                    };
                    // BW's fog curve caps unexplored darkness at 218/255 for observers/replays.
                    let unexplored_mask = if self.is_replay_or_obs() {
                        218.0 / 255.0
                    } else {
                        1.0
                    };
                    // Where each mask texture sits on the map, in map pixels: the minimap's
                    // covers the whole map, the main view's the game screen.
                    let screen_origin = [
                        self.screen_x.resolve() as f32,
                        self.screen_y.resolve() as f32,
                    ];
                    let screen_span = [
                        self.game_screen_width_bwpx.resolve() as f32,
                        self.game_screen_height_bwpx.resolve() as f32,
                    ];
                    let map_span = [
                        self.map_width_pixels.resolve() as f32,
                        self.map_height_pixels.resolve() as f32,
                    ];
                    let fog_style = fog_style::fog_style();
                    let tileset = (*self.game()).tileset;
                    let vertex_buffer = self.vertex_buffer.resolve();
                    for i in 0..draw_command_count {
                        let cmd = &raw mut (*commands).commands[i];
                        if (*cmd).shader_id == SHADER_ID_MASK {
                            let is_minimap = is_minimap_mask_draw(&*cmd, vertex_buffer);
                            let (origin, span) = if is_minimap {
                                ([0.0, 0.0], map_span)
                            } else {
                                (screen_origin, screen_span)
                            };
                            let c = &mut (*cmd).shader_constants;
                            c[0] = use_new_mask;
                            c[1] = show_network_stalled;
                            c[2] = unexplored_mask;
                            c[4..6].copy_from_slice(&origin);
                            c[6..8].copy_from_slice(&span);
                            c[17..19].copy_from_slice(&map_span);
                            fog_style.write_shader_constants(c, is_minimap, tileset);
                        }
                    }
                    let ret = {
                        let _timing = crate::frame_timing::render();
                        orig(renderer, commands, width, height)
                    };
                    #[cfg(debug_assertions)]
                    crate::input_latency_probe::on_rendered();
                    if let Some(mut render_state) = self.render_state.lock() {
                        draw_inject::free_textures(&mut render_state.render);
                    }
                    ret
                },
                relative,
            );

            let relative = swap_buffers - base;
            exe.hook_closure_address(
                Renderer_SwapBuffers,
                move |renderer, orig| {
                    crate::frame_pacing::presenting_frame();
                    let ret = orig(renderer);
                    crate::frame_pacing::frame_presented();
                    ret
                },
                relative,
            );

            // CreateShader hook
            let relative = create_shader.cast_usize() - base;
            exe.hook_closure_address(
                Renderer_CreateShader,
                move |renderer, shader, text, vertex, pixel, arg5, orig| {
                    {
                        let mut renderer_state = self.renderer_state.lock();
                        renderer_state.set_shader_inputs(shader, vertex, pixel);
                    }
                    orig(renderer, shader, text, vertex, pixel, arg5)
                },
                relative,
            );

            for (id, shader_set) in self.shader_replaces.iter_shaders() {
                if let Some(&address) = self.prism_pixel_shaders.get(id as usize) {
                    let patch = scr::PrismShaderSet {
                        count: shader_set.len() as u32,
                        shaders: shader_set.as_ptr() as *mut _,
                    };
                    let relative = address.0 as usize - base;
                    exe.replace_val(relative, patch);
                }
            }
        }
    }
}

/// The callbacks `draw_graphic_layers` runs before drawing any layer, as SC:R passed them, with
/// [`hide_tooltip_layer_if_console_hidden`] after them.
unsafe fn with_tooltip_layer_hider(
    callbacks: *mut c_void,
    count: usize,
) -> Vec<unsafe extern "C" fn()> {
    // The count is a 32-bit int, which the game loops over as signed; on x86_64 the upper half of
    // its register is not part of it.
    let count = usize::try_from(count as u32 as i32).unwrap_or(0);
    let mut out = Vec::with_capacity(count + 1);
    if count != 0 && !callbacks.is_null() {
        out.extend_from_slice(unsafe {
            std::slice::from_raw_parts(callbacks as *const unsafe extern "C" fn(), count)
        });
    }
    out.push(hide_tooltip_layer_if_console_hidden as unsafe extern "C" fn());
    out
}

/// Keeps SC:R's tooltip layer (graphic layer 1) from drawing while the console is hidden: every
/// tooltip it can show while a game runs belongs to a console control.
///
/// Hiding the console's dialogs doesn't stop the command panel's update from arming a tooltip. The
/// update runs among `draw_graphic_layers`' callbacks whenever the panel is marked for a refresh
/// (every second of game time, every blink of a paused replay's indicator, and on selection and
/// unit changes) and hit-tests the pointer against the panel's buttons, which checks each button's
/// own visibility but not the hidden dialog's. Hiding the layer before those callbacks run misses
/// what they turn on, so this runs after them, before any layer draws.
unsafe extern "C" fn hide_tooltip_layer_if_console_hidden() {
    let bw = get_bw();
    if bw.console_hidden()
        && let Some(layers) = bw
            .graphic_layers
            .and_then(|x| NonNull::new(unsafe { x.resolve() }))
    {
        unsafe {
            (*layers.as_ptr().add(1)).draw = 0;
        }
    }
}
