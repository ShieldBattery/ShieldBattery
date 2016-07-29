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
    # All things that generate a node binary output (exe, dll) should depend on this to pull in
    # the proper libraries, include dirs, and defines.
    {
      'target_name': 'node-binary',
      'type': 'static_library',
      'direct_dependent_settings': {
        'include_dirs': [
          '.',
          'deps/node/src',
          'deps/node/deps/uv/include',
          'deps/node/deps/v8/include',
          'nan/<!(cd nan && node -e "require(\'nan\')")',
        ],
        'defines': [
          'BUILDING_UV_SHARED=1',
          'BUILDING_V8_SHARED=1',
        ],
        'libraries': [
          '-lnode.lib',
          '-lv8_base_0.lib',
          '-lv8_base_1.lib',
          '-lv8_base_2.lib',
          '-lv8_base_3.lib',
          '-lv8_libbase.lib',
          '-lv8_inspector_stl.lib',
          '-licui18n.lib',
          '-licuucx.lib',
          '-licudata.lib',
          '-licustubdata.lib',
          '-lv8_snapshot.lib',
          '-lv8_libplatform.lib',
          '-lopenssl.lib',
          '-lzlib.lib',
          '-lhttp_parser.lib',
          '-lcares.lib',
          '-llibuv.lib',
          '-lwinmm.lib',
          '-lws2_32.lib',
          '-lpsapi.lib',
          '-lgdi32.lib',
          '-liphlpapi.lib',
        ],
      },
      # VS won't generate a lib file unless we provide sources (which will then cause a build
      # failure if anything depends on this), so we provide an empty file to satisfy it.
      'sources': [
        'nan/node_binary.cpp',
      ],
    },

    {
      'target_name': 'shieldbattery',
      'type': 'shared_library',
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
      ],
      'dependencies': [
        'common',
        'logger',
        'node-binary',
        'v8-helpers',
        'deps/glew/glew.gyp:glew',
      ],
      'link_settings': {
        'libraries': [
          '-luser32.lib',
          '-lgdi32.lib',
          '-lD3D10.lib',
          '-ld3dcompiler.lib',
          '-lshell32.lib',
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
        'nan/<!(cd nan && node -e "require(\'nan\')")',
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

    {
      'target_name': 'scout',
      'type': 'shared_library',
      'include_dirs': [
        '.',
      ],
      'sources': [
        'scout/scout.cpp',
      ],
      'dependencies': [
        'common',
      ],
    },

    {
      'target_name': 'psi',
      'type': 'executable',
      'sources': [
        'node-psi/module.cpp',
        'node-psi/wrapped_process.cpp',
        'node-psi/wrapped_registry.cpp',

        'psi/psi.cpp',

        # headers
        'node-psi/module.h',
        'node-psi/wrapped_process.h',
        'node-psi/wrapped_registry.h',

        'psi/psi.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)psi/psi.props',
      ],
      'dependencies': [
        'common',
        'node-binary',
        'v8-helpers',
      ],
      'msvs_disabled_warnings': [ 4506, 4251, 4530 ],
      'msvs_settings': {
        'VCLinkerTool': {
          'ForceSymbolReferences': [ '<@(forced_references)' ],
        },
      },
      'libraries': [ '-luser32.lib' ],
    },

    {
      'target_name': 'psi-emitter',
      'type': 'executable',
      'include_dirs': [
        '.',
      ],
      'msvs_settings': {
        'VCLinkerTool': {
          'target_conditions': [
            # in a target_conditions so it executes late and overrides includes
            ['_type=="executable"', {
              'AdditionalOptions=': [ '/SubSystem:Windows' ],
            }],
          ],
        },
      },
      'sources': [
        'psi-emitter/psi-emitter.cpp',
        # headers
        'psi-emitter/psi-emitter.h',
      ],
      'msbuild_props': [
        '$(SolutionDir)psi-emitter/psi-emitter.props',
      ],
      'dependencies': [
        'common',
      ],
      'libraries': [ '-luser32.lib', '-lshell32.lib', '-lversion.lib' ],
    },
  ],
}
