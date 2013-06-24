{
  'targets': [
    {
      'target_name': 'bw',
      'include_dirs=': [
        '<(node_root_dir)/',
        '<(node_root_dir)/deps/node/src',
        '<(node_root_dir)/deps/node/deps/uv/include',
        '<(node_root_dir)/deps/node/deps/v8/include',
      ],
      'sources': [
        'src/module.cpp',
        'src/brood_war.cpp',
        'src/wrapped_brood_war.cpp',
        # headers
        'src/brood_war.h',
        'src/wrapped_brood_war.h',
      ],
      'dependencies': [
        '<(node_root_dir)/shieldbattery.gyp:common',
      ],
      # node-gyp + nodedir doesn't work right with relative paths, so we override that with our own
      # less general settings
      'libraries=': [ '-l<(node_root_dir)/$(Configuration)/shieldbattery.lib' ],
      'msvs_disabled_warnings': [ 4506 ],
    }
  ]
}
