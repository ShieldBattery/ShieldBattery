{
  'target_defaults': {
    'msvs_settings': {
      'VCLibrarianTool': {
        # For whatever reason, the node target doesn't get this set correctly atm
        'TargetMachine': 1, # X86
      },
    },
    'target_conditions': [
      # Silenced warnings copied (and enhanced) from
      # https://github.com/atom/electron/blob/master/common.gypi
      ['_target_name in ["libuv", "http_parser", "openssl", "openssl-cli", "cares", "node", "v8_snapshot", "v8_nosnapshot", "v8_libbase", "v8_base_0", "v8_base_1", "v8_base_2", "v8_base_3", "v8_libplatform", "zlib"]', {
        'msvs_disabled_warnings': [
          4003,  # Not enough arguments for macro.
          4013,  # 'free' undefined; assuming extern returning int
          4018,  # signed/unsigned mismatch
          4054,  #
          4055,  # 'type cast' : from data pointer 'void *' to function pointer
          4057,  # 'function' : 'volatile LONG *' differs in indirection to slightly different base types from 'unsigned long *'
          4091,  # typedef ignored
          4189,  #
          4131,  # uses old-style declarator
          4133,  # incompatible types
          4146,  # unary minus operator applied to unsigned type, result still unsigned
          4164,  # intrinsic function not declared
          4152,  # function/data pointer conversion in expression
          4206,  # translation unit is empty
          4204,  # non-constant aggregate initializer
          4210,  # nonstandard extension used : function given file scope
          4214,  # bit field types other than int
          4232,  # address of dllimport 'free' is not static, identity not guaranteed
          4244,  # conversion from int64_t to int32_t
          4251,  # std class needs to have dll-interface
          4267,  # down-conversion of size_t, possible loss of data
          4291,  # no matching operator delete found
          4295,  # array is too small to include a terminating null character
          4389,  # '==' : signed/unsigned mismatch
          4701,  # potentially uninitialized local variable 'sizew' used
          4703,  # potentially uninitialized local pointer variable 'req' used
          4706,  # assignment within conditional expression
          4804,  # unsafe use of type 'bool' in operation
          4996,  # this function or variable may be unsafe.
        ],
        'msvs_settings': {
          'VCLibrarianTool': {
            'AdditionalOptions': [
              '/ignore:4221'  # Object file doesn't define any public symbols, not included (ICU, openssl)
            ],
          },
        },
      }],
    ],
  },
}
