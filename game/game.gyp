{
  'variables': {
    'library': 'static_library',
    # For whatever reason, VS likes to optimize away the builtins initialization functions in the
    # node static lib, so we have to force references to all of them in any of our executables that
    # utilize node
    'forced_references': [
      '__register_async_wrap_',
      '__register_buffer_',
      '__register_cares_wrap_',
      '__register_config_',
      '__register_contextify_',
      '__register_crypto_',
      '__register_fs_',
      '__register_fs_event_wrap_',
      '__register_http_parser_',
      '__register_js_stream_',
      '__register_os_',
      '__register_pipe_wrap_',
      '__register_process_wrap_',
      '__register_signal_wrap_',
      '__register_spawn_sync_',
      '__register_stream_wrap_',
      '__register_tcp_wrap_',
      '__register_timer_wrap_',
      '__register_tls_wrap_',
      '__register_tty_wrap_',
      '__register_udp_wrap_',
      '__register_url_',
      '__register_util_',
      '__register_uv_',
      '__register_v8_',
      '__register_zlib_',
    ],
  },

  'target_defaults': {
    'msvs_settings': {
      'VCLinkerTool': {
        'AdditionalLibraryDirectories': [
          'deps/node/$(Configuration)/lib/', # node + libuv
          'deps/node/build/$(Configuration)/lib/', # v8
        ],
      },
    },
  },

  'targets': [
    {
      'target_name': 'shieldbattery',
      'type': 'shared_library',
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
        '<!(node -e "require(\'nan\')")',
      ],
      'sources': [
        'forge/indirect_draw.cpp',
        'forge/indirect_draw_palette.cpp',
        'forge/indirect_draw_surface.cpp',
        'forge/forge.cpp',
        'forge/module.cpp',
        'forge/direct_x.cpp',
        'forge/open_gl.cpp',
        'forge/renderer_utils.cpp',

        'node-bw/module.cpp',
        'node-bw/brood_war.cpp',
        'node-bw/immediate.cpp',
        'node-bw/wrapped_brood_war.cpp',

        'shieldbattery/shieldbattery.cpp',

        'snp/functions.cpp',
        'snp/module.cpp',
        'snp/snp.cpp',

        # headers
        'forge/indirect_draw.h',
        'forge/forge.h',
        'forge/direct_x.h',
        'forge/open_gl.h',
        'forge/renderer.h',
        'forge/renderer_utils.h',

        'node-bw/brood_war.h',
        'node-bw/forge_interface.h',
        'node-bw/immediate.h',
        'node-bw/wrapped_brood_war.h',

        'shieldbattery/settings.h',
        'shieldbattery/shieldbattery.h',

        'snp/functions.h',
        'snp/module-priv.h',
        'snp/snp.h',

        # exports
        'snp/snp.def',
      ],
      'msbuild_props': [
        '$(SolutionDir)shieldbattery/shieldbattery.props',
      ],
      'defines': [
        'WIN32_LEAN_AND_MEAN',
        'BUILDING_UV_SHARED=1',
        'BUILDING_V8_SHARED=1',
      ],
      'dependencies': [
        'common',
        'logger',
        'v8-helpers',
        'deps/glew/glew.gyp:glew',
      ],
      'link_settings': {
        'libraries': [
          '-lcares.lib',
          '-lD3D10.lib',
          '-ld3dcompiler.lib',
          '-lgdi32.lib',
          '-lhttp_parser.lib',
          '-licudata.lib',
          '-licui18n.lib',
          '-licustubdata.lib',
          '-licuucx.lib',
          '-liphlpapi.lib',
          '-llibuv.lib',
          '-lnode.lib',
          '-lopenssl.lib',
          '-lpsapi.lib',
          '-lshell32.lib',
          '-lshlwapi.lib',
          '-lstandalone_inspector.lib',
          '-luser32.lib',
          '-lv8_base_0.lib',
          '-lv8_base_1.lib',
          '-lv8_base_2.lib',
          '-lv8_base_3.lib',
          '-lv8_libbase.lib',
          '-lv8_libplatform.lib',
          '-lv8_libsampler.lib',
          '-lv8_snapshot.lib',
          '-lwinmm.lib',
          '-lws2_32.lib',
          '-lzlib.lib',
        ],
      },
      'msvs_disabled_warnings': [ 4506, 4251, 4530, 4838, 4996 ],
      'msvs_settings': {
        'VCLinkerTool': {
          'DelayLoadDLLs': ['opengl32.dll', 'd3d10.dll', 'd3dcompiler_47.dll'],
          'ForceSymbolReferences': [ '<@(forced_references)' ],
        },
      },
    },

    {
      'target_name': 'common',
      'type': 'static_library',
      'include_dirs': [
        '.',
      ],
      'sources': [
        'common/func_hook.cpp',
        'common/win_helpers.cpp',
        # headers
        'common/func_hook.h',
        'common/macros.h',
        'common/types.h',
        'common/win_helpers.h',
      ],
      'direct_dependent_settings': {
        'libraries': [
          '-ladvapi32.lib',
          '-lWtsapi32.lib',
          '-luser32.lib',
          '-lUserenv.lib',
          '-ldbghelp.lib',
          '-lole32.lib',
          '-lshell32.lib',
        ],
      },
      'dependencies': [
        'deps/udis86/udis86.gyp:libudis86'
      ],
      'msvs_disabled_warnings': [ 4996, 4091 ],
    },

    {
      'target_name': 'v8-helpers',
      'type': 'static_library',
      'sources': [
        'v8-helpers/helpers.cpp',
        # headers
        'v8-helpers/helpers.h',
      ],
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
        '<!(node -e "require(\'nan\')")',
      ],
      'defines': [
        'WIN32_LEAN_AND_MEAN',
      ],
    },

    {
      'target_name': 'logger',
      'type': 'static_library',
      'sources': [
        'logger/logger.cpp',
        # headers
        'logger/logger.h',
      ],
      'include_dirs': [
        '.',
        'deps/node/src',
        'deps/node/deps/uv/include',
        'deps/node/deps/v8/include',
      ],
    },
  ],
}
