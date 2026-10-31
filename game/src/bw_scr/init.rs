//! Analysis of the loaded executable and construction of the game adapter.

use std::mem;
use std::path::Path;
use std::ptr::null;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicU32, AtomicUsize};
use std::sync::{Arc, OnceLock};

use parking_lot::{Mutex, RwLock};
use scr_analysis::{DatType, VirtualAddress, scarf};
use winapi::um::libloaderapi::GetModuleHandleW;

use super::network::NetcodeV2Bw;
use super::sdf_cache::{InitSdfCache, SdfCache};
use super::selection::{SelectionState, SelectionVisualPools, SelectionVisuals};
use super::shader_replaces::ShaderReplaces;
use super::thiscall::Thiscall;

use crate::app_messages::{AtomicStartingFog, StartingFog};
use crate::bw::apm_stats::ApmStats;
use crate::bw::{self, Bw};
use crate::bw_scr::game_stats::GameStats;
use crate::recurse_checked_mutex::Mutex as RecurseCheckedMutex;
use crate::sync::DumbSpinLock;
use crate::windows;

use super::{
    BottomOverpan, BwInitError, BwScr, ChatInjection, ClickFeedback, GrabPan, LinkedList,
    MinimapDrawHooks, ObserverUiCallbacks, PaletteColorLookup, PlacementOverlayPools, PylonAuras,
    RenderState, RendererState, SendPtr, SkinTable, SoftwareCursor, UnitCostCache, Value, chat,
    chat_history, draw_inject, draw_overlay, game_locale, game_settings, hotkey_presses, pe_image,
    replay_playback, replay_save, replay_vision_choice, resolve_operand, sound,
    sprite_coordinate_decoder, stat_txt, tick_gates,
};

impl BwScr {
    /// On failure returns a description of address that couldn't be found
    pub fn new() -> Result<BwScr, BwInitError> {
        let binary = unsafe {
            let base = GetModuleHandleW(null()) as *const u8;
            let text = pe_image::get_section(base, b".text\0\0\0").unwrap();
            let rdata = pe_image::get_section(base, b".rdata\0\0").unwrap();
            let data = pe_image::get_section(base, b".data\0\0\0").unwrap();
            let reloc = pe_image::get_section(base, b".reloc\0\0").unwrap();
            #[cfg(target_arch = "x86_64")]
            let pdata = pe_image::get_section(base, b".pdata\0\0").unwrap();

            #[cfg(target_arch = "x86")]
            let sections = vec![pe_image::get_pe_header(base), text, rdata, data, reloc];
            #[cfg(target_arch = "x86_64")]
            let sections = vec![
                pe_image::get_pe_header(base),
                text,
                rdata,
                data,
                pdata,
                reloc,
            ];

            let base = VirtualAddress(base as _);
            #[allow(unused_mut)] // As mutation is needed only on the cfg(x86) part
            let mut binary = scarf::raw_bin(base, sections);
            #[cfg(target_arch = "x86")]
            {
                let relocs =
                    scarf::analysis::find_relocs::<scarf::ExecutionStateX86<'_>>(&binary).unwrap();
                binary.set_relocs(relocs);
            }
            binary
        };
        let exe_build = get_exe_build();
        info!("StarCraft build {exe_build}");
        // We probably would be able to support some older versions too, but require at least the
        // initial 1.23.9 patch (1.23.9.9899, from July 2021).
        if exe_build < 9899 {
            return Err(BwInitError::UnsupportedVersion(exe_build));
        }

        let analysis_ctx = scarf::OperandContext::new();
        let mut analysis = scr_analysis::Analysis::new(&binary, &analysis_ctx);

        let ctx: scarf::OperandCtx<'static> = Box::leak(Box::new(scarf::OperandContext::new()));
        let game = analysis.game().ok_or("Game")?;
        let game_data = analysis.game_data().ok_or("Game Data")?;
        let players = analysis.players().ok_or("Players")?;
        let pathing = analysis.pathing().ok_or("Pathing")?;
        let chk_players = analysis.chk_init_players().ok_or("CHK players")?;
        let init_chk_player_types = analysis
            .original_chk_player_types()
            .ok_or("Orig CHK player types")?;
        let storm_players = analysis.storm_players().ok_or("Storm players")?;
        let init_network_player_info = analysis
            .init_net_player()
            .ok_or("init_network_player_info")?;
        let storm_player_flags = analysis.net_player_flags().ok_or("Storm player flags")?;
        let step_network = analysis.step_network().ok_or("step_network")?;
        let lobby_state = analysis.lobby_state().ok_or("Lobby state")?;
        let is_multiplayer = analysis.is_multiplayer().ok_or("is_multiplayer")?;
        let in_lobby_or_game = analysis.in_lobby_or_game().ok_or("in_lobby_or_game")?;
        let select_map_entry = analysis.select_map_entry().ok_or("select_map_entry")?;
        let game_state = analysis.game_state().ok_or("Game state")?;
        let rng_seed = analysis.rng_seed().ok_or("RNG seed")?;
        let sc_main = analysis.sc_main();
        let mainmenu_entry_hook = analysis.mainmenu_entry_hook().ok_or("Entry hook")?;
        let game_loop = analysis.game_loop().ok_or("Game loop")?;
        let init_map_from_path = analysis.init_map_from_path().ok_or("init_map_from_path")?;
        let join_game = analysis.join_game().ok_or("join_game")?;
        let init_sprites = analysis.load_images().ok_or("Init sprites")?;
        let init_real_time_lighting = analysis.init_real_time_lighting();
        let sprites_inited = analysis.images_loaded().ok_or("Sprites inited")?;
        let init_game_network = analysis.init_game_network().ok_or("Init game network")?;
        let storm_create_game = analysis.storm_create_game().ok_or("storm_create_game")?;
        let process_lobby_commands = analysis
            .process_lobby_commands()
            .ok_or("Process lobby commands")?;
        // Non-fatal: without it, base player colors stay as BW left them (deterministic slot order)
        // rather than failing game launch.
        let randomize_player_colors = analysis.randomize_player_colors();
        if randomize_player_colors.is_none() {
            warn!("Could not find randomize_player_colors; base colors will not randomize");
        }
        let send_command = analysis.send_command().ok_or("send_command")?;
        let is_replay = analysis.is_replay().ok_or("is_replay")?;
        let local_player_id = analysis.local_player_id().ok_or("Local player id")?;
        let local_storm_id = analysis.local_storm_player_id().ok_or("Local storm id")?;
        let local_unique_player_id = analysis
            .local_unique_player_id()
            .ok_or("Local unique player id")?;
        let command_user = analysis.command_user().ok_or("Command user")?;
        let unique_command_user = analysis
            .unique_command_user()
            .ok_or("Unique command user")?;
        let storm_command_user = analysis.storm_command_user().ok_or("Storm command user")?;
        let is_network_ready = analysis.network_ready().ok_or("Is network ready")?;
        let net_user_latency = analysis.net_user_latency().ok_or("Net user latency")?;
        let net_format_turn_rate = analysis
            .net_format_turn_rate()
            .ok_or("net_format_turn_rate")?;
        let net_player_to_game = analysis.net_player_to_game().ok_or("Net player to game")?;
        let net_player_to_unique = analysis
            .net_player_to_unique()
            .ok_or("Net player to unique")?;
        let choose_snp = analysis.choose_snp().ok_or("choose_snp")?;
        let local_player_name = analysis.local_player_name().ok_or("Local player name")?;
        let fonts = analysis.fonts().ok_or("Fonts")?;
        let init_storm_networking = analysis
            .init_storm_networking()
            .ok_or("init_storm_networking")?;
        let load_snp_list = analysis.load_snp_list().ok_or("load_snp_list")?;
        let start_udp_server = analysis.start_udp_server().ok_or("start_udp_server")?;
        let font_cache_render_ascii = analysis
            .font_cache_render_ascii()
            .ok_or("font_cache_render_ascii")?;
        let ttf_malloc = analysis.ttf_malloc().ok_or("ttf_malloc")?;
        let find_game_type_template = analysis
            .find_game_type_template()
            .ok_or("find_game_type_template")?;
        let ttf_render_sdf = analysis.ttf_render_sdf().ok_or("ttf_render_sdf")?;
        let lobby_create_callback_offset = analysis
            .create_game_dialog_vtbl_on_multiplayer_create()
            .ok_or("Lobby create callback vtable offset")?;
        let process_events = analysis.process_events().ok_or("process_events")?;
        let process_game_commands = analysis.process_commands().ok_or("process_game_commands")?;
        let game_command_lengths = analysis.command_lengths();
        let snet_recv_packets = analysis.snet_recv_packets().ok_or("snet_recv_packets")?;
        let snet_send_packets = analysis.snet_send_packets().ok_or("snet_send_packets")?;
        let step_io = analysis.step_io().ok_or("step_io")?;
        let init_game_data = analysis.init_game().ok_or("init_game_data")?;
        let init_unit_data = analysis.init_units().ok_or("init_unit_data")?;
        let step_replay_commands = analysis
            .step_replay_commands()
            .ok_or("step_replay_commands")?;
        let save_replay = analysis.save_replay().ok_or("save_replay")?;
        let order_harvest_gas = analysis.order_harvest_gas().ok_or("order_harvest_gas")?;
        let order_reset_collision_harvester = analysis
            .order_reset_collision_harvester()
            .ok_or("order_reset_collision_harvester")?;
        let do_next_queued_order = analysis
            .do_next_queued_order()
            .ok_or("do_next_queued_order")?;
        let order_attack_unit = analysis.order_attack_unit().ok_or("order_attack_unit")?;
        let check_unit_resources_and_supply = analysis
            .check_unit_resources_and_supply()
            .ok_or("check_unit_resources_and_supply")?;
        let check_cached_resources = analysis
            .check_cached_resources()
            .ok_or("check_cached_resources")?;
        let unit_cost_cache = UnitCostCache {
            minerals: Value::new(
                ctx,
                analysis
                    .cached_mineral_costs()
                    .ok_or("cached_mineral_costs")?,
            ),
            gas: Value::new(ctx, analysis.cached_gas_costs().ok_or("cached_gas_costs")?),
            supply: Value::new(
                ctx,
                analysis
                    .cached_supply_costs()
                    .ok_or("cached_supply_costs")?,
            ),
            check_resources: unsafe { mem::transmute(check_cached_resources.0) },
        };

        let prism_pixel_shaders = analysis
            .prism_pixel_shaders()
            .ok_or("Prism pixel shaders")?;
        let prism_renderer_vtable = analysis.prism_renderer_vtable().ok_or("Prism renderer")?;
        let dx9_renderer_vtables = analysis.dx9_renderer_vtables();
        let console_vtables = analysis.console_vtables();

        let first_active_unit = analysis.first_active_unit().ok_or("first_active_unit")?;
        let bwapi_terrain = if crate::bwapi::analysis_requested() {
            super::bwapi::Terrain::analyze(&mut analysis, ctx)
        } else {
            None
        };
        let first_player_unit = analysis.first_player_unit().ok_or("first_player_unit")?;
        let client_selection = analysis.client_selection().ok_or("client_selection")?;
        let sprite_x = analysis.sprite_x().ok_or("sprite_x")?;
        let sprite_y = analysis.sprite_y().ok_or("sprite_y")?;
        let sprites_by_y_tile = analysis
            .sprites_by_y_tile_start()
            .ok_or("sprites_by_y_tile_start")?;
        let sprites_by_y_tile_end = analysis
            .sprites_by_y_tile_end()
            .ok_or("sprites_by_y_tile_end")?;
        let step_game = analysis.step_game().ok_or("step_game")?;
        let free_sprites = LinkedList {
            start: Value::new(
                ctx,
                analysis.first_free_sprite().ok_or("first_free_sprite")?,
            ),
            end: Value::new(ctx, analysis.last_free_sprite().ok_or("last_free_sprite")?),
        };
        let active_fow_sprites = LinkedList {
            start: Value::new(
                ctx,
                analysis
                    .first_active_fow_sprite()
                    .ok_or("first_active_fow_sprite")?,
            ),
            end: Value::new(
                ctx,
                analysis
                    .last_active_fow_sprite()
                    .ok_or("last_active_fow_sprite")?,
            ),
        };
        let free_fow_sprites = LinkedList {
            start: Value::new(
                ctx,
                analysis
                    .first_free_fow_sprite()
                    .ok_or("first_free_fow_sprite")?,
            ),
            end: Value::new(
                ctx,
                analysis
                    .last_free_fow_sprite()
                    .ok_or("last_free_fow_sprite")?,
            ),
        };
        let free_images = LinkedList {
            start: Value::new(ctx, analysis.first_free_image().ok_or("first_free_image")?),
            end: Value::new(ctx, analysis.last_free_image().ok_or("last_free_image")?),
        };
        let free_orders = LinkedList {
            start: Value::new(ctx, analysis.first_free_order().ok_or("first_free_order")?),
            end: Value::new(ctx, analysis.last_free_order().ok_or("last_free_order")?),
        };

        let replay_data = analysis.replay_data().ok_or("replay_data")?;
        let replay_header = analysis.replay_header().ok_or("replay_header")?;
        let trigger_execution_timer = analysis
            .trigger_execution_timer()
            .ok_or("trigger_execution_timer")?;
        let next_game_step_tick = analysis.next_game_step_tick();
        #[cfg(debug_assertions)]
        let turn_timer_accumulator = analysis.turn_timer_accumulator();
        let replay_seek_frame = analysis.replay_seek_frame();
        let local_selection = analysis.local_selection();
        let simulated_selections = analysis.selections();
        let enable_rng = analysis.enable_rng().ok_or("Enable RNG")?;
        let replay_visions = analysis.replay_visions().ok_or("replay_visions")?;
        let local_visions = analysis.local_visions().ok_or("local_visions")?;
        let minimap_tile_vision_mask = analysis.minimap_tile_vision_mask();
        if minimap_tile_vision_mask.is_none() {
            warn!("Analysis could not find minimap_tile_vision_mask");
        }
        let replay_show_entire_map = analysis
            .replay_show_entire_map()
            .ok_or("replay_show_entire_map")?;
        let allocator = analysis.allocator().ok_or("allocator")?;
        let allocated_order_count = analysis
            .allocated_order_count()
            .ok_or("allocated_order_count")?;
        let order_limit = analysis.order_limit().ok_or("order_limit")?;
        let replay_bfix = analysis.replay_bfix();
        let replay_gcfg = analysis.replay_gcfg();
        let prepare_issue_order = analysis
            .prepare_issue_order()
            .ok_or("prepare_issue_order")?;
        let create_game_multiplayer = analysis
            .create_game_multiplayer()
            .ok_or("create_game_multiplayer")?;
        let spawn_dialog = analysis.spawn_dialog().ok_or("spawn_dialog")?;
        let step_game_logic = analysis.step_game_logic().ok_or("step_game_logic")?;
        let step_game_loop = analysis.step_game_loop();
        let anti_troll = analysis.anti_troll();
        let first_dialog = analysis.first_dialog();
        let graphic_layers = analysis.graphic_layers();
        let snet_local_player_list = analysis.snet_local_player_list();
        let units = analysis.units().ok_or("units")?;
        // Non-fatal: the control-groups panel simply does not dim a group nobody has recalled.
        let selection_hotkey_last_used_frames = analysis.selection_hotkey_last_used_frames();
        let map_tile_flags = analysis.map_tile_flags();
        // Non-fatal: without the registry the in-game options screen still saves what the player
        // changes, and SC:R picks it up next game.
        let game_settings = match (
            // A global the analysis resolves to its address, like the other struct globals.
            analysis
                .game_setting_groups()
                .and_then(|groups| groups.if_constant()),
            analysis.update_game_setting_int(),
            analysis.update_game_setting_bool(),
        ) {
            (Some(groups), Some(write_int), Some(write_bool)) => {
                Some((groups, write_int, write_bool))
            }
            _ => {
                warn!("Could not find SC:R's settings registry");
                None
            }
        };
        // Non-fatal: without it the overlay keeps to the language the settings ask for.
        let game_locale = analysis
            .get_locales()
            .map(|get_locales| game_locale::GameLocale::new(get_locales.0 as usize));
        if game_locale.is_none() {
            warn!("Could not find get_locales; the overlay will not follow the game's language");
        }
        // Non-fatal: without stat_txt the overlay's panels only go without names. Both are globals
        // the analysis resolves to their address; the map's renames are only needed to know when
        // the stock name is the wrong one, so a build without them still names every unit.
        let stat_txt = match analysis
            .stat_txt_string_table()
            .and_then(|table| table.if_constant())
        {
            Some(table) => {
                let overrides = analysis
                    .unit_map_name_overrides()
                    .and_then(|overrides| overrides.if_constant());
                if overrides.is_none() {
                    warn!("Could not find unit_map_name_overrides");
                }
                Some(stat_txt::StatTxt::new(
                    table as usize,
                    overrides.map(|x| x as usize),
                ))
            }
            None => {
                warn!("Could not find stat_txt_string_table; the overlay will not name units");
                None
            }
        };
        let vertex_buffer = analysis.vertex_buffer().ok_or("vertex_buffer")?;
        let renderer = analysis.renderer().ok_or("renderer")?;
        let draw_commands = analysis.draw_commands().ok_or("draw_commands")?;
        let map_width_pixels = analysis.map_width_pixels().ok_or("map_width_pixels")?;
        let map_height_pixels = analysis.map_height_pixels().ok_or("map_height_pixels")?;
        let main_palette = analysis.main_palette().ok_or("main_palette")?;
        let rgb_colors = analysis.rgb_colors().ok_or("rgb_colors")?;
        let use_rgb_colors = analysis.use_rgb_colors().ok_or("use_rgb_colors")?;
        // Non-fatal: without it the zoom-ignoring effect sounds just keep their native behavior.
        let sfx_data = analysis.sfx_data();
        if sfx_data.is_none() {
            warn!("Could not find sfx_data global");
        }
        // These two are non-fatal: if the analysis can't locate them we just lose the
        // save/restore of the minimap color/terrain toggles rather than failing game launch.
        let minimap_color_mode = analysis.minimap_color_mode();
        if minimap_color_mode.is_none() {
            warn!("Could not find minimap_color_mode global");
        }
        let minimap_terrain_hidden = analysis.minimap_terrain_hidden();
        if minimap_terrain_hidden.is_none() {
            warn!("Could not find minimap_terrain_hidden global");
        }
        // Non-fatal, all-or-nothing: reading or writing skin blobs needs both the table base and
        // its stride. Without them peers just see default skins, as they would natively when a
        // blob never arrives.
        let skin_table = match (analysis.player_skins(), analysis.skins_size()) {
            (Some(base), Some(stride)) => Some((base, stride)),
            _ => {
                warn!("Could not find player_skins/skins_size; peer skins will not be relayed");
                None
            }
        };
        let skins = analysis.skins();
        if skins.is_none() {
            warn!("Could not find skins local source; own-skin relay may be host-only");
        }
        // Non-fatal, all-or-nothing: the three minimap dot-draw functions are hooked together so the
        // minimap-only team-color mode can swap the palette for the span of the draw. Without all
        // three that mode falls back to BW's own diplomacy dots rather than failing game launch.
        let minimap_draw_hooks = match (
            analysis.draw_minimap_units(),
            analysis.draw_minimap_player_units(),
            analysis.draw_minimap_main_player_units(),
        ) {
            (
                Some(draw_minimap_units),
                Some(draw_minimap_player_units),
                Some(draw_minimap_main_player_units),
            ) => Some(MinimapDrawHooks {
                draw_minimap_units,
                draw_minimap_player_units,
                draw_minimap_main_player_units,
            }),
            _ => {
                warn!(
                    "Could not find all minimap draw functions; minimap-only team colors will use BW diplomacy dots"
                );
                None
            }
        };
        let get_player_color = analysis.get_player_color();
        if get_player_color.is_none() {
            warn!("Could not find get_player_color; neutral units will keep their native color");
        }
        let update_minimap_dialog_horizontal_offset =
            analysis.update_minimap_dialog_horizontal_offset();
        if update_minimap_dialog_horizontal_offset.is_none() {
            warn!(
                "Could not find update_minimap_dialog_horizontal_offset; watchers' minimap will \
                follow the minimap position setting"
            );
        }
        // Non-fatal, all-or-nothing: the nearest-palette-color guard needs the function to hook and
        // the cycling table pointer whose null state it checks for.
        let palette_color_lookup = match (
            analysis.find_nearest_palette_color(),
            analysis.is_cycling_color_table(),
        ) {
            (Some(find_nearest_palette_color), Some(is_cycling_color_table)) => {
                Some(PaletteColorLookup {
                    find_nearest_palette_color,
                    is_cycling_color_table: Value::new(ctx, is_cycling_color_table),
                })
            }
            _ => {
                warn!(
                    "Could not find find_nearest_palette_color/is_cycling_color_table; palette \
                    lookups without a loaded tileset will stay unguarded"
                );
                None
            }
        };
        // Non-fatal, all-or-nothing: replacing the replay file safely needs the path that the save
        // is going to write to, which only the path builder can produce.
        let replay_autosave = match (
            analysis.save_replay_by_name(),
            analysis.build_replay_file_path(),
        ) {
            (Some(save_replay_by_name), Some(build_replay_file_path)) => {
                Some(replay_save::ReplayAutosave {
                    save_replay_by_name,
                    build_replay_file_path: unsafe { mem::transmute(build_replay_file_path.0) },
                })
            }
            // Background clients require both entry points so autosave cannot delete the
            // player's LastReplay before writing is suppressed.
            _ if crate::is_background_game() => {
                return Err("background replay autosave suppression".into());
            }
            _ => {
                warn!(
                    "Could not find save_replay_by_name/build_replay_file_path; SC:R will handle \
                    its own replay autosave"
                );
                None
            }
        };
        // Non-fatal: without it, in-game chat can't read its send-scope and every message goes to
        // everyone rather than failing game launch.
        let chat_box_mode = analysis.chat_box_mode();
        if chat_box_mode.is_none() {
            warn!("Could not find chat_box_mode global");
        }
        let is_paused = analysis.is_paused();
        if is_paused.is_none() {
            warn!("Could not find is_paused global");
        }
        let statres_icons = analysis.statres_icons().ok_or("statres_icons")?;
        let cmdicons = analysis.cmdicons().ok_or("cmdicons")?;
        let wirefram = analysis.wirefram();
        if wirefram.is_none() {
            warn!("Could not find wirefram ddsgrp");
        }
        let screen_x = analysis.screen_x().ok_or("screen_x")?;
        let screen_y = analysis.screen_y().ok_or("screen_y")?;
        let game_screen_width_bwpx = analysis
            .game_screen_width_bwpx()
            .ok_or("game_screen_width_bwpx")?;
        let game_screen_height_bwpx = analysis
            .game_screen_height_bwpx()
            .ok_or("game_screen_height_bwpx")?;
        let game_screen_height_ratio = analysis.game_screen_height_ratio();
        let zoom = analysis.zoom().ok_or("zoom")?;
        let bottom_overpan = (|| {
            Some(BottomOverpan {
                padding_tiles: Value::new(ctx, analysis.screen_scroll_bottom_padding_tiles()?),
                scroll_max_y: Value::new(ctx, analysis.screen_scroll_max_y()?),
                update_scroll_bounds: unsafe {
                    std::mem::transmute::<usize, unsafe extern "C" fn()>(
                        analysis.update_screen_scroll_bounds()?.0 as usize,
                    )
                },
            })
        })();
        if bottom_overpan.is_none() {
            warn!("No screen scroll padding; the view stops at the map's bottom edge");
        }
        let move_screen = analysis.move_screen().ok_or("move_screen")?;
        // Non-fatal: without these the middle-mouse grab pan keeps the game's built-in behavior
        // instead of failing game launch. Resolve each piece separately so a missing one names
        // itself in the log rather than disabling the whole feature anonymously.
        let grab_pan_middle_down = analysis.ui_default_middle_down_handler();
        let grab_pan_middle_up = analysis.ui_default_middle_up_handler();
        let grab_pan_table = analysis.global_event_handlers();
        let grab_pan = match (grab_pan_middle_down, grab_pan_middle_up, grab_pan_table) {
            (Some(down), Some(up), Some(table)) => Some((down, up, table)),
            _ => {
                warn!(
                    "Could not find grab pan pieces; adjustable grab pan sensitivity is disabled. \
                     middle_down_handler={}, middle_up_handler={}, global_event_handlers={}",
                    grab_pan_middle_down.is_some(),
                    grab_pan_middle_up.is_some(),
                    grab_pan_table.is_some(),
                );
                None
            }
        };
        let update_game_screen_size = analysis
            .update_game_screen_size()
            .ok_or("update_game_screen_size")?;
        let move_unit = analysis.move_unit().ok_or("move_unit")?;
        let get_render_target = analysis.get_render_target().ok_or("get_render_target")?;
        let load_consoles = analysis.load_consoles().ok_or("load_consoles")?;
        let init_consoles = analysis.init_consoles().ok_or("init_consoles")?;
        let get_ui_consoles = analysis.get_ui_consoles().ok_or("get_ui_consoles")?;
        let init_obs_ui = analysis.init_obs_ui().ok_or("init_obs_ui")?;
        let draw_graphic_layers = analysis
            .draw_graphic_layers()
            .ok_or("draw_graphic_layers")?;
        let software_cursor = match (
            analysis.draw_software_cursor(),
            analysis.push_renderer_mode_override(),
            analysis.pop_renderer_mode_override(),
        ) {
            (Some(draw), Some(push_mode_override), Some(pop_mode_override)) => {
                Some(SoftwareCursor {
                    draw,
                    push_mode_override: unsafe { mem::transmute(push_mode_override.0) },
                    pop_mode_override: unsafe { mem::transmute(pop_mode_override.0) },
                })
            }
            _ => None,
        };
        let render_screen = analysis.render_screen().ok_or("render_screen")?;
        let skip_render = analysis.skip_render();
        if skip_render.is_none() && crate::is_background_game() {
            warn!("Background render skipping is unavailable for this StarCraft build");
        }
        let decide_cursor_type = analysis.decide_cursor_type().ok_or("decide_cursor_type")?;
        let tick_gated_work = tick_gates::TickGatedWork {
            screen_scrolling: analysis.update_screen_scrolling().zip(
                analysis
                    .screen_scroll_last_tick_negated()
                    .map(|x| Value::new(ctx, x)),
            ),
            palette_cycling: analysis.update_palette_cycles().zip(
                analysis
                    .palette_cycle_last_tick()
                    .map(|x| Value::new(ctx, x)),
            ),
            cursor_animation: (|| {
                Some(tick_gates::CursorAnimation {
                    update_game_cursor: analysis.update_game_cursor()?,
                    step_menu_cursor_animation: analysis.step_menu_cursor_animation()?,
                    next_frame_tick: Value::new(ctx, analysis.cursor_animation_next_tick()?),
                })
            })(),
        };
        if tick_gated_work.screen_scrolling.is_none()
            || tick_gated_work.palette_cycling.is_none()
            || tick_gated_work.cursor_animation.is_none()
        {
            warn!(
                "Could not find all tick-gated work; what's missing runs faster than on \
                 Battle.net. screen_scrolling={}, palette_cycling={}, cursor_animation={}",
                tick_gated_work.screen_scrolling.is_some(),
                tick_gated_work.palette_cycling.is_some(),
                tick_gated_work.cursor_animation.is_some(),
            );
        }
        let load_ddsgrp_cursor = analysis.load_ddsgrp_cursor().ok_or("load_ddsgrp_cursor")?;
        let cursor_scale_factor = analysis
            .cursor_scale_factor()
            .ok_or("cursor_scale_factor")?;
        let select_units = analysis.select_units().ok_or("select_units")?;
        let lookup_sound_id = analysis.lookup_sound_id().ok_or("lookup_sound")?;
        let play_sound = analysis.play_sound().ok_or("play_sound")?;
        let load_sfx_audio_object = if crate::is_background_game() {
            let result = analysis.load_sfx_audio_object();
            if result.is_none() {
                warn!("Background sound asset skipping is unavailable for this StarCraft build");
            }
            result
        } else {
            None
        };
        let print_text_addr = analysis.print_text().ok_or("print_text")?;
        let net_player_count_addr = analysis.net_player_count().ok_or("net_player_count")?;
        #[cfg(debug_assertions)]
        let engine_alloc = analysis.engine_alloc().ok_or("engine_alloc")?;
        #[cfg(debug_assertions)]
        let engine_free = analysis.engine_free().ok_or("engine_free")?;
        // Everything from here to the snapshot ranges is only needed by a game that rolls back,
        // so none of it failing to resolve is fatal: this DLL just can't roll back (see
        // `rollback_missing_analysis`). Whether a game rolls back is only known once its session
        // is set up, long after analysis, so these are always resolved.
        let observer_ui_callbacks = ObserverUiCallbacks::analyze(&mut analysis);
        let selection_visuals = SelectionVisuals::analyze(&mut analysis);
        let selection_visual_pools = SelectionVisualPools::analyze(&mut analysis, ctx);
        let click_feedback = ClickFeedback::analyze(&mut analysis);
        let placement_overlays = PlacementOverlayPools::analyze(&mut analysis, ctx);
        let delayed_control_activations = (|| {
            let entries = analysis.delayed_control_activations()?;
            let process = analysis.process_delayed_control_activations()?;
            Some(hotkey_presses::DelayedControlActivations::new(
                ctx,
                entries,
                unsafe { std::mem::transmute::<usize, unsafe extern "C" fn()>(process.0 as usize) },
            ))
        })();
        if delayed_control_activations.is_none() {
            warn!("Analysis could not find the delayed control activations");
        }
        let pylon_auras = PylonAuras::analyze(&mut analysis, ctx);
        let mission_dialog_openers = analysis
            .open_defeat_mission_dialog()
            .zip(analysis.open_victory_mission_dialog());
        let show_game_message = analysis.show_game_message();
        let rollback_ranges = crate::rollback::ranges::analyze_ranges(&mut analysis, ctx);

        let uses_new_join_param_variant = match analysis.join_param_variant_type_offset() {
            Some(0) => false,
            #[cfg(target_arch = "x86")]
            Some(0x20) => true,
            #[cfg(target_arch = "x86_64")]
            Some(0x28) => true,
            _ => return Err(BwInitError::AnalysisFail("join_param_variant_layout")),
        };

        let starcraft_tls_index = analysis.get_tls_index().ok_or("TLS index")?;

        let open_file = analysis
            .file_hook()
            .ok_or("open_file (Required due to SB_NO_HD)")?;

        let replay_minimap_patch = analysis.replay_minimap_unexplored_fog_patch();
        let cursor_dimension_patch = analysis.cursor_dimension_patch();

        let status_screen_funcs = analysis.status_screen_funcs();
        let original_status_screen_update = if let Some(arr) = status_screen_funcs {
            unsafe {
                let arr = arr.0 as *const bw::UnitStatusFunc;
                (0..228).map(|i| (*arr.add(i)).update_status).collect()
            }
        } else {
            Vec::new()
        };

        // Required: a resolution failure fails launch (full cutover to rally-point2, no native
        // fallback at the launch level).
        let netcode_v2 = NetcodeV2Bw::analyze(&mut analysis, ctx)?;

        init_bw_dat(&mut analysis)?;

        debug!("Found all necessary BW data");

        let sdf_cache = Arc::new(InitSdfCache::new());
        Ok(BwScr {
            game: Value::new(ctx, game),
            game_data: Value::new(ctx, game_data),
            players: Value::new(ctx, players),
            chk_players: Value::new(ctx, chk_players),
            pathing: Value::new(ctx, pathing),
            init_chk_player_types: Value::new(ctx, init_chk_player_types),
            storm_players: Value::new(ctx, storm_players),
            storm_player_flags: Value::new(ctx, storm_player_flags),
            lobby_state: Value::new(ctx, lobby_state),
            is_multiplayer: Value::new(ctx, is_multiplayer),
            in_lobby_or_game: Value::new(ctx, in_lobby_or_game),
            game_state: Value::new(ctx, game_state),
            sprites_inited: Value::new(ctx, sprites_inited),
            is_replay: Value::new(ctx, is_replay),
            local_player_id: Value::new(ctx, local_player_id),
            local_unique_player_id: Value::new(ctx, local_unique_player_id),
            local_storm_id: Value::new(ctx, local_storm_id),
            command_user: Value::new(ctx, command_user),
            unique_command_user: Value::new(ctx, unique_command_user),
            storm_command_user: Value::new(ctx, storm_command_user),
            rng_seed: Value::new(ctx, rng_seed),
            is_network_ready: Value::new(ctx, is_network_ready),
            net_user_latency: Value::new(ctx, net_user_latency),
            net_player_to_game: Value::new(ctx, net_player_to_game),
            net_player_to_unique: Value::new(ctx, net_player_to_unique),
            local_player_name: Value::new(ctx, local_player_name),
            fonts: Value::new(ctx, fonts),
            first_active_unit: Value::new(ctx, first_active_unit),
            bwapi_terrain,
            sound: sound::Sound::new(
                sfx_data.map(|x| Value::new(ctx, x)),
                unsafe { mem::transmute(lookup_sound_id.0) },
                unsafe { mem::transmute(play_sound.0) },
            ),
            first_player_unit: Value::new(ctx, first_player_unit),
            selection: SelectionState::new(
                Value::new(ctx, client_selection),
                local_selection.map(|x| Value::new(ctx, x)),
                simulated_selections.map(|x| Value::new(ctx, x)),
                unsafe { mem::transmute(select_units.0) },
                selection_visuals,
                selection_visual_pools,
            ),
            sprites_by_y_tile: Value::new(ctx, sprites_by_y_tile),
            sprites_by_y_tile_end: Value::new(ctx, sprites_by_y_tile_end),
            sprite_x: (
                sprite_coordinate_decoder(ctx, sprite_x.0),
                sprite_x.1,
                sprite_x.2,
            ),
            sprite_y: (
                sprite_coordinate_decoder(ctx, sprite_y.0),
                sprite_y.1,
                sprite_y.2,
            ),
            replay_data: Value::new(ctx, replay_data),
            replay_header: Value::new(ctx, replay_header),
            trigger_execution_timer: Value::new(ctx, trigger_execution_timer),
            next_game_step_tick: next_game_step_tick.map(|x| Value::new(ctx, x)),
            #[cfg(debug_assertions)]
            turn_timer_accumulator: turn_timer_accumulator.map(|x| Value::new(ctx, x)),
            replay_seek_frame: replay_seek_frame.map(|x| Value::new(ctx, x)),
            enable_rng: Value::new(ctx, enable_rng),
            replay_visions: Value::new(ctx, replay_visions),
            local_visions: Value::new(ctx, local_visions),
            minimap_tile_vision_mask: minimap_tile_vision_mask.map(|x| Value::new(ctx, x)),
            replay_show_entire_map: Value::new(ctx, replay_show_entire_map),
            allocator: Value::new(ctx, allocator),
            allocated_order_count: Value::new(ctx, allocated_order_count),
            order_limit: Value::new(ctx, order_limit),
            units: Value::new(ctx, units),
            selection_hotkey_last_used_frames: selection_hotkey_last_used_frames
                .map(|frames| Value::new(ctx, frames)),
            map_tile_flags: map_tile_flags.map(|flags| Value::new(ctx, flags)),
            vertex_buffer: Value::new(ctx, vertex_buffer),
            renderer: Value::new(ctx, renderer),
            draw_commands: Value::new(ctx, draw_commands),
            map_width_pixels: Value::new(ctx, map_width_pixels),
            map_height_pixels: Value::new(ctx, map_height_pixels),
            main_palette: Value::new(ctx, main_palette),
            rgb_colors: Value::new(ctx, rgb_colors),
            use_rgb_colors: Value::new(ctx, use_rgb_colors),
            minimap_color_mode: minimap_color_mode.map(|op| Value::new(ctx, op)),
            minimap_terrain_hidden: minimap_terrain_hidden.map(|op| Value::new(ctx, op)),
            skin_table: skin_table.map(|(base, stride)| SkinTable {
                base: Value::new(ctx, base),
                stride: stride as usize,
            }),
            skins: skins.map(|op| Value::new(ctx, op)),
            minimap_draw_hooks,
            palette_color_lookup,
            get_player_color,
            update_minimap_dialog_horizontal_offset,
            replay_autosave,
            chat_box_mode: chat_box_mode.map(|op| Value::new(ctx, op)),
            is_paused: is_paused.map(|op| Value::new(ctx, op)),
            statres_icons: Value::new(ctx, statres_icons),
            cmdicons: Value::new(ctx, cmdicons),
            wirefram: wirefram.map(|op| Value::new(ctx, op)),
            wireframe_remap: OnceLock::new(),
            screen_x: Value::new(ctx, screen_x),
            screen_y: Value::new(ctx, screen_y),
            grab_pan: grab_pan.map(|(middle_down_handler, middle_up_handler, table)| GrabPan {
                middle_down_handler,
                middle_up_handler,
                global_event_handlers: Value::new(ctx, table),
                anchor: Mutex::new(None),
            }),
            grab_pan_sensitivity_on: AtomicBool::new(false),
            grab_pan_gain: AtomicU32::new(1.0f32.to_bits()),
            grab_pan_inverted: AtomicBool::new(false),
            game_screen_width_bwpx: Value::new(ctx, game_screen_width_bwpx),
            game_screen_height_bwpx: Value::new(ctx, game_screen_height_bwpx),
            zoom: Value::new(ctx, zoom),
            bottom_overpan,
            cursor_scale_factor: Value::new(ctx, cursor_scale_factor),
            game_screen_height_ratio: game_screen_height_ratio.map(move |x| Value::new(ctx, x)),
            replay_bfix: replay_bfix.map(move |x| Value::new(ctx, x)),
            replay_gcfg: replay_gcfg.map(move |x| Value::new(ctx, x)),
            anti_troll: anti_troll.map(move |x| Value::new(ctx, x)),
            first_dialog: first_dialog.map(move |x| Value::new(ctx, x)),
            graphic_layers: graphic_layers.map(move |x| Value::new(ctx, x)),
            snet_local_player_list: snet_local_player_list.map(move |x| Value::new(ctx, x)),
            netcode_v2,
            free_sprites,
            active_fow_sprites,
            free_fow_sprites,
            free_images,
            free_orders,
            uses_new_join_param_variant,
            status_screen_funcs,
            original_status_screen_update,
            net_format_turn_rate,
            init_obs_ui,
            draw_graphic_layers,
            software_cursor,
            decide_cursor_type,
            tick_gated_work,
            delayed_control_activations,
            load_ddsgrp_cursor,
            update_game_screen_size: unsafe { mem::transmute(update_game_screen_size.0) },
            init_network_player_info: unsafe { mem::transmute(init_network_player_info.0) },
            step_network: unsafe { mem::transmute(step_network.0) },
            step_network_addr: step_network,
            select_map_entry: unsafe { mem::transmute(select_map_entry.0) },
            game_loop: unsafe { mem::transmute(game_loop.0) },
            init_map_from_path: unsafe { mem::transmute(init_map_from_path.0) },
            join_game: unsafe { mem::transmute(join_game.0) },
            init_sprites: unsafe { mem::transmute(init_sprites.0) },
            init_real_time_lighting: unsafe {
                init_real_time_lighting.map(|x| mem::transmute(x.0))
            },
            init_game_network: unsafe { mem::transmute(init_game_network.0) },
            storm_create_game: unsafe { mem::transmute(storm_create_game.0) },
            process_lobby_commands: unsafe { mem::transmute(process_lobby_commands.0) },
            randomize_player_colors: randomize_player_colors
                .map(|f| unsafe { mem::transmute::<usize, unsafe extern "C" fn()>(f.0 as usize) }),
            send_command: unsafe { mem::transmute(send_command.0) },
            choose_snp: unsafe { mem::transmute(choose_snp.0) },
            init_storm_networking: unsafe { mem::transmute(init_storm_networking.0) },
            snet_recv_packets: unsafe { mem::transmute(snet_recv_packets.0) },
            snet_send_packets: unsafe { mem::transmute(snet_send_packets.0) },
            ttf_malloc: unsafe { mem::transmute(ttf_malloc.0) },
            find_game_type_template: unsafe { mem::transmute(find_game_type_template.0) },
            process_events: unsafe { mem::transmute(process_events.0) },
            process_game_commands: unsafe { mem::transmute(process_game_commands.0) },
            move_screen: unsafe { mem::transmute(move_screen.0) },
            get_render_target: unsafe { mem::transmute(get_render_target.0) },
            load_consoles: Thiscall::foreign(load_consoles.0 as usize),
            init_consoles: Thiscall::foreign(init_consoles.0 as usize),
            move_unit: Thiscall::foreign(move_unit.0 as usize),
            get_ui_consoles: unsafe { mem::transmute(get_ui_consoles.0) },
            render_screen: unsafe { mem::transmute(render_screen.0) },
            skip_render: skip_render.map(|x| unsafe { mem::transmute(x.0) }),
            load_sfx_audio_object,
            print_text: unsafe { mem::transmute(print_text_addr.0) },
            save_replay: unsafe { mem::transmute(save_replay.0) },
            load_snp_list,
            start_udp_server,
            sc_main,
            mainmenu_entry_hook,
            open_file,
            lobby_create_callback_offset,
            font_cache_render_ascii,
            ttf_render_sdf,
            step_replay_commands,
            order_harvest_gas,
            order_reset_collision_harvester,
            do_next_queued_order,
            order_attack_unit,
            check_unit_resources_and_supply,
            unit_cost_cache,
            step_game,
            step_io,
            init_game_data,
            init_unit_data,
            game_command_lengths,
            prism_pixel_shaders,
            prism_renderer_vtable,
            dx9_renderer_vtables,
            console_vtables,
            replay_minimap_patch,
            cursor_dimension_patch,
            prepare_issue_order,
            create_game_multiplayer,
            spawn_dialog,
            step_game_logic,
            step_game_loop,
            print_text_addr,
            net_player_count_addr,
            #[cfg(debug_assertions)]
            engine_alloc,
            #[cfg(debug_assertions)]
            engine_free,
            observer_ui_callbacks,
            click_feedback,
            placement_overlays,
            pylon_auras,
            mission_dialog_openers,
            show_game_message,
            rollback_ranges,
            starcraft_tls_index: SendPtr(starcraft_tls_index),
            exe_build,
            sdf_cache,
            is_replay_seeking: AtomicBool::new(false),
            replay_start_seek_sent: AtomicBool::new(false),
            lobby_game_init_command_seen: AtomicBool::new(false),
            disable_hd: AtomicBool::new(false),
            shader_replaces: ShaderReplaces::new(),
            renderer_state: Mutex::new(RendererState {
                shader_inputs: Vec::with_capacity(0x30),
            }),
            open_replay_file_count: AtomicUsize::new(0),
            open_replay_files: Mutex::new(Vec::new()),
            is_carbot: AtomicBool::new(false),
            show_skins: AtomicBool::new(false),
            is_hd_mode: [AtomicBool::new(true), AtomicBool::new(false)],
            last_overlay_hd_value: AtomicBool::new(false),
            hd_switching: AtomicBool::new(false),
            overlay_draw_commands: (AtomicU32::new(0), AtomicU32::new(0)),
            software_cursor_draw_commands: (AtomicU32::new(0), AtomicU32::new(0)),
            starting_fog: AtomicStartingFog::new(StartingFog::Transparent),
            saved_minimap_color_mode: AtomicU8::new(0),
            saved_minimap_terrain_hidden: AtomicBool::new(false),
            minimap_settings_restored: AtomicBool::new(false),
            skin_broadcast_attempts: AtomicU32::new(0),
            skin_offset_validated: AtomicBool::new(false),
            team_color_config: Mutex::new(None),
            team_color_runtime: Mutex::new(None),
            use_legacy_cursor_sizing: AtomicBool::new(false),
            use_custom_cursor_size: AtomicBool::new(false),
            custom_cursor_size: Mutex::new(0.25),
            visualize_network_stalls: AtomicBool::new(false),
            is_processing_game_commands: AtomicBool::new(false),
            in_network_stall: AtomicBool::new(false),
            network_stall_start: RwLock::new(None),
            dropped_players: AtomicU32::new(0),
            settings_file_path: RwLock::new(String::new()),
            detection_status_copy: Mutex::new(Vec::new()),
            render_state: RecurseCheckedMutex::new(RenderState {
                render: draw_inject::RenderState::new(),
                overlay: draw_overlay::OverlayState::new(),
                debug_statbtn_dialog_offset: (0, 0),
            }),
            apm_state: RecurseCheckedMutex::new(ApmStats::new()),
            game_stats: RecurseCheckedMutex::new(GameStats::new()),
            original_game_screen_height_ratio: AtomicU32::new(0),
            obs_ui_init_as_player: AtomicBool::new(false),
            console_hidden_state: AtomicBool::new(false),
            followed_unit: Mutex::new(None),
            minimap_hidden_state: AtomicBool::new(false),
            command_panel_hidden_state: AtomicBool::new(false),
            game_started: AtomicBool::new(false),
            init_uploads_settling: AtomicBool::new(false),
            game_results_sent: AtomicBool::new(false),
            first_game_logic_frame_done: AtomicBool::new(false),
            countdown_start: Mutex::new(None),
            turn_rate_readout_at: Mutex::new(None),
            print_text_hooks_disabled: AtomicI32::new(0),
            chat_injection: AtomicU8::new(ChatInjection::Live as u8),
            chat_shown_while_stalled: Mutex::new(Vec::new()),
            chat_manager: Mutex::new(chat::ChatManager::new()),
            chat_history: Mutex::new(chat_history::ChatHistory::new()),
            replay_playback: Mutex::new(replay_playback::ReplayPlayback::new()),
            replay_vision_choice: Mutex::new(replay_vision_choice::ReplayVisionChoice::new()),
            options: Mutex::new(overlay_ui::options::OptionsView::default()),
            engine_settings: Mutex::new(Default::default()),
            option_lists: Mutex::new(Arc::new(overlay_ui::options::OptionsLists::default())),
            observer_panels: Mutex::new(None),
            game_settings: game_settings.map(|(groups, write_int, write_bool)| {
                game_settings::GameSettings::new(
                    groups as usize,
                    write_int.0 as usize,
                    write_bool.0 as usize,
                )
            }),
            posted_graphics_keys: AtomicU8::new(0),
            pending_game_setting_writes: Mutex::new(Vec::new()),
            stat_txt,
            game_locale,
            settings_locale: Mutex::new(overlay_ui::i18n::Locale::En),
            event_processing_lock: DumbSpinLock::new(),
        })
    }

    pub unsafe fn post_async_init(&'static self) {
        unsafe {
            let base = GetModuleHandleW(null()) as usize;
            let sdf_cache = self.sdf_cache.clone();
            let async_handle = crate::async_handle();
            let mut sdf_cache = sdf_cache.lock_owned();
            async_handle.spawn(async move {
                let exe_hash = pe_image::hash_pe_header(base as *const u8);
                *sdf_cache = Some(SdfCache::init(exe_hash).await);
            });
        }
    }
}

fn init_bw_dat(analysis: &mut scr_analysis::Analysis<'_>) -> Result<(), &'static str> {
    unsafe fn copy_dat_table(
        table: &scr_analysis::DatTablePtr<'_>,
        out: &mut Vec<bw::DatTable>,
        entries: usize,
    ) {
        unsafe {
            // Dat tables in SC:R memory have at least one extra field, bw_dat expects
            // 1.16.1 compatible format.
            let mut value = resolve_operand(table.address, &[]) as *const u8;
            for _ in 0..entries {
                let bw_table = value as *mut bw::DatTable;
                out.push(bw::DatTable {
                    data: (*bw_table).data,
                    entry_size: (*bw_table).entry_size,
                    entries: (*bw_table).entries,
                });
                value = value.add(table.entry_size as usize);
            }
        }
    }

    let units = analysis.dat_table(DatType::Units).ok_or("units.dat")?;
    let weapons = analysis.dat_table(DatType::Weapons).ok_or("weapons.dat")?;
    let upgrades = analysis
        .dat_table(DatType::Upgrades)
        .ok_or("upgrades.dat")?;
    let techdata = analysis
        .dat_table(DatType::TechData)
        .ok_or("techdata.dat")?;
    let orders = analysis.dat_table(DatType::Orders).ok_or("orders.dat")?;
    let images = analysis.dat_table(DatType::Images).ok_or("images.dat")?;
    let mut out = Vec::with_capacity(0x36 + 0x18 + 0xc + 0xb + 0x13 + 0xe);
    unsafe {
        copy_dat_table(&units, &mut out, 0x36);
        copy_dat_table(&weapons, &mut out, 0x18);
        copy_dat_table(&upgrades, &mut out, 0xc);
        copy_dat_table(&techdata, &mut out, 0xb);
        copy_dat_table(&orders, &mut out, 0x13);
        copy_dat_table(&images, &mut out, 0xe);
        let mut table = out.leak().as_ptr();
        bw_dat::init_units(table, 0x36);
        table = table.add(0x36);
        bw_dat::init_weapons(table, 0x18);
        table = table.add(0x18);
        bw_dat::init_upgrades(table, 0xc);
        table = table.add(0xc);
        bw_dat::init_techdata(table, 0xb);
        table = table.add(0xb);
        bw_dat::init_orders(table, 0x13);
        table = table.add(0x13);
        bw_dat::init_images(table, 0xe);
        bw_dat::set_is_scr(true);
        bw_dat::set_bw_malloc(bw_malloc, bw_free);
    }
    Ok(())
}

pub(super) unsafe extern "C" fn bw_malloc(size: usize) -> *mut u8 {
    unsafe { bw::get_bw().alloc(size) }
}

pub(super) unsafe extern "C" fn bw_free(ptr: *mut u8) {
    unsafe { bw::get_bw().free(ptr) }
}

pub(super) fn get_exe_build() -> u32 {
    let exe_path = windows::module_name(std::ptr::null_mut()).expect("Couldn't get exe path");
    match windows::version::get_version(Path::new(&exe_path)) {
        Some(s) => s.3 as u32,
        None => 0,
    }
}
