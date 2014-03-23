var expect = require('chai').expect
  , proto = require('..')

function bindDecode(str) {
  return proto.decode.bind(proto, str)
}

function bindEncode(obj) {
  return proto.encode.bind(proto, obj)
}

describe('nydus-protocol', function() {
  describe('#decode()', function() {
    it('should throw on invalid JSON', function() {
      expect(proto.decode.bind(proto, '[}')).to.throw(Error)
    })

    it('should throw on non-Array JSON', function() {
      expect(bindDecode('{ test: true }')).to.throw(Error)
    })

    it('should throw on empty Array JSON', function() {
      expect(bindDecode('[]')).to.throw(Error)
    })
  })

  describe('#decode(WELCOME)', function() {
    it('should parse valid messages', function() {
      var message = [ proto.WELCOME, 1, 'NydusServer/1.0.1' ]
        , encoded = JSON.stringify(message)
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.WELCOME
                            , protocolVersion: 1
                            , serverAgent: 'NydusServer/1.0.1'
                            })
    })

    it('should throw on invalidly typed messages', function() {
      var message = [ proto.WELCOME, '1', 'NydusServer/1.0.1' ]
        , encoded = JSON.stringify(message)
      expect(bindDecode(encoded)).to.throw(Error)

      message = [ proto.WELCOME, 1, 1 ]
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on shortened messages', function() {
      var message = [ proto.WELCOME, 1 ]
        , encoded = JSON.stringify(message)
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(CALL)', function() {
    it('should parse parameter-less messages', function() {
      var encoded = JSON.stringify([ proto.CALL, 'coolId', '/test/path' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.CALL
                            , requestId: 'coolId'
                            , procPath: '/test/path'
                            , params: []
                            })
    })

    it('should parse single parameter messages', function() {
      var encoded = JSON.stringify([ proto.CALL, 'coolId', '/test/path', 'param' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.CALL
                            , requestId: 'coolId'
                            , procPath: '/test/path'
                            , params: [ 'param' ]
                            })
    })

    it('should parse vararg messages', function() {
      var encoded = JSON.stringify( [ proto.CALL
                                    , 'coolId'
                                    , '/test/path'
                                    , 'param'
                                    , 7
                                    , { test: true }
                                    , [ 1, 2, 3, 'four' ]
                                    ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.CALL
                            , requestId: 'coolId'
                            , procPath: '/test/path'
                            , params: [ 'param'
                                      , 7
                                      , { test: true }
                                      , [ 1, 2, 3, 'four' ]
                                      ]
                            })
    })

    it('should throw on invalidly typed messages', function() {
      var encoded = JSON.stringify([ proto.CALL, 7, '/test/path' ])
      expect(bindDecode(encoded)).to.throw(Error)

      encoded = JSON.stringify([ proto.CALL, 'coolId', 7 ])
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on shortened messages', function() {
      var encoded = JSON.stringify([ proto.CALL, 'coolId' ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(RESULT)', function() {
    it('should parse result-less messages', function() {
      var encoded = JSON.stringify([ proto.RESULT, 'coolId' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.RESULT
                            , requestId: 'coolId'
                            , results: []
                            })
    })

    it('should parse single result messages', function() {
      var encoded = JSON.stringify([ proto.RESULT, 'coolId', 'result' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.RESULT
                            , requestId: 'coolId'
                            , results: [ 'result' ]
                            })
    })

    it('should parse many result messages', function() {
      var encoded = JSON.stringify( [ proto.RESULT
                                    , 'coolId'
                                    , 'result'
                                    , 7
                                    , { test: true }
                                    , [ 1, 2, 3, 'four' ]
                                    ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.RESULT
                            , requestId: 'coolId'
                            , results: [ 'result'
                                      , 7
                                      , { test: true }
                                      , [ 1, 2, 3, 'four' ]
                                      ]
                            })
    })

    it('should throw on invalidly typed messages', function() {
      var encoded = JSON.stringify([ proto.RESULT, 7 ])
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on shortened messages', function() {
      var encoded = JSON.stringify([ proto.RESULT ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(ERROR)', function() {
    it('should parse a detail-less message', function() {
      var encoded = JSON.stringify([ proto.ERROR, 'coolId', 403, 'unauthorized' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.ERROR
                            , requestId: 'coolId'
                            , errorCode: 403
                            , errorDesc: 'unauthorized'
                            })
    })

    it('should parsed a message with details', function() {
      var encoded = JSON.stringify([ proto.ERROR, 'coolId', 403, 'unauthorized',
            { message: 'You are not authorized to do this' }])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.ERROR
                            , requestId: 'coolId'
                            , errorCode: 403
                            , errorDesc: 'unauthorized'
                            , errorDetails: { message: 'You are not authorized to do this' }
                            })
    })

    it('should throw on shortened messages', function() {
      var encoded = JSON.stringify([ proto.ERROR, 'coolId', 403 ])
      expect(bindDecode(encoded)).throw(Error)
    })

    it('should throw on invalidly typed messages', function() {
      var encoded = JSON.stringify([ proto.ERROR, 7, 403, 'unauthorized' ])
      expect(bindDecode(encoded)).to.throw(Error)

      encoded = JSON.stringify([ proto.ERROR, 'coolId', 'code', 'unauthorized'])
      expect(bindDecode(encoded)).to.throw(Error)

      encoded = JSON.stringify([ proto.ERROR, 'coolId', 403, 7 ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(SUBSCRIBE)', function() {
    it('should parse a valid message', function() {
      var encoded = JSON.stringify([ proto.SUBSCRIBE, 'coolId', '/test/path' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.SUBSCRIBE
                            , requestId: 'coolId'
                            , topicPath: '/test/path'
                            })
    })

    it('should throw on shortened messages', function() {
      var encoded = JSON.stringify([ proto.SUBSCRIBE, 'coolId' ])
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on invalid types', function() {
      var encoded = JSON.stringify([ proto.SUBSCRIBE, 7, '/test/path' ])
      expect(bindDecode(encoded)).to.throw(Error)

      encoded = JSON.stringify([ proto.SUBSCRIBE, 'coolId', 7 ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(UNSUBSCRIBE)', function() {
    it('should parse a valid message', function() {
      var encoded = JSON.stringify([ proto.UNSUBSCRIBE, 'coolId', '/test/path' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.UNSUBSCRIBE
                            , requestId: 'coolId'
                            , topicPath: '/test/path'
                            })
    })

    it('should throw on shortened messages', function() {
      var encoded = JSON.stringify([ proto.UNSUBSCRIBE ])
      expect(bindDecode(encoded)).to.throw(Error)
      encoded = JSON.stringify([ proto.UNSUBSCRIBE, 'coolId' ])
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on invalid types', function() {
      var encoded = JSON.stringify([ proto.UNSUBSCRIBE, 7, '/test/path' ])
      expect(bindDecode(encoded)).to.throw(Error)
      encoded = JSON.stringify([ proto.UNSUBSCRIBE, 'coolId', 7 ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(PUBLISH)', function() {
    it('should parse a valid message using default excludeMe', function() {
      var encoded = JSON.stringify([ proto.PUBLISH, '/test/path', 'event' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.PUBLISH
                            , topicPath: '/test/path'
                            , event: 'event'
                            , excludeMe: false
                            })
    })

    it('should parse a valid message with excludeMe specified', function() {
      var encoded = JSON.stringify([ proto.PUBLISH, '/test/path', 'event', true ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.PUBLISH
                            , topicPath: '/test/path'
                            , event: 'event'
                            , excludeMe: true
                            })
    })

    it('should throw on shortened messages', function() {
      var encoded = JSON.stringify([ proto.PUBLISH, '/test/path' ])
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on invalid types', function() {
      var encoded = JSON.stringify([ proto.PUBLISH, 7, 'event', true ])
      expect(bindDecode(encoded)).to.throw(Error)

      encoded = JSON.stringify([ proto.PUBLISH, '/test/path', 'event', 1 ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#decode(EVENT)', function() {
    it('should parse valid messages', function() {
      var encoded = JSON.stringify([ proto.EVENT, '/test/path', 'event' ])
        , result = proto.decode(encoded)
      expect(result).to.eql({ type: proto.EVENT
                            , topicPath: '/test/path'
                            , event: 'event'
                            })
    })

    it('should throw on shortned messages', function() {
      var encoded = JSON.stringify([ proto.EVENT, '/test/path' ])
      expect(bindDecode(encoded)).to.throw(Error)
    })

    it('should throw on invalid types', function() {
      var encoded = JSON.stringify([ proto.EVENT, 7, 'event' ])
      expect(bindDecode(encoded)).to.throw(Error)
    })
  })

  describe('#encode()', function() {
    it('should throw on invalid types', function() {
      expect(bindEncode({})).to.throw(Error)
      expect(bindEncode({ type: 256 })).to.throw(Error)
    })
  })

  describe('#encode(WELCOME)', function() {
    it('should encode a valid message', function() {
      var obj = { type: proto.WELCOME
                , serverAgent: 'AwesomeServer/1.0.1'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.eql([ proto.WELCOME
                                        , proto.protocolVersion
                                        , 'AwesomeServer/1.0.1'
                                        ])
    })

    it('should convert serverAgent to a string', function() {
      var obj = { type: proto.WELCOME, serverAgent: 7 }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.WELCOME
                                                , proto.protocolVersion
                                                , '7'
                                                ])
    })

    it('should throw on incomplete objects', function() {
      expect(bindEncode({ type: proto.WELCOME })).to.throw(Error)
      expect(bindEncode({ type: proto.WELCOME, serverAgent: null })).to.throw(Error)
    })
  })

  describe('#encode(CALL)', function() {
    it('should throw on incomplete objects', function() {
      var obj = { type: proto.CALL
                , requestId: 'coolId'
                , procPath: null
                }
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.procPath
      expect(bindEncode(obj)).to.throw(Error)
      obj.procPath = '/test/path'
      obj.requestId = null
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.requestId
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should throw on incorrectly typed params', function() {
      var obj = { type: proto.CALL
                , requestId: 'coolId'
                , procPath: '/test/path'
                , params: 7
                }
      expect(bindEncode(obj)).to.throw(Error)
      obj.params = 'asdf'
      expect(bindEncode(obj)).to.throw(Error)
      obj.params = {}
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should encode a valid parameterless object', function() {
      var obj = { type: proto.CALL
                , requestId: 'coolId'
                , procPath: '/test/path'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.CALL
                                                , 'coolId'
                                                , '/test/path'
                                                ])
    })

    it('should encode an object with an empty parameter list', function() {
      var obj = { type: proto.CALL
                , requestId: 'coolId'
                , procPath: '/test/path'
                , params: []
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.CALL
                                                , 'coolId'
                                                , '/test/path'
                                                ])
    })

    it('should encode an object with parameters', function() {
      var obj = { type: proto.CALL
                , requestId: 'coolId'
                , procPath: '/test/path'
                , params: [ 7
                          , { test: true }
                          , 'test'
                          , [ 'arrays' ]
                          ]
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.CALL
                                                , 'coolId'
                                                , '/test/path'
                                                , 7
                                                , { test: true }
                                                , 'test'
                                                , [ 'arrays' ]
                                                ])
    })

    it('should coerce values to correct types', function() {
      var obj = { type: proto.CALL
                , requestId: 7
                , procPath: 4
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.CALL
                                                , '7'
                                                , '4'
                                                ])
    })
  })

  describe('#encode(RESULT)', function() {
    it('should throw on incomplete objects', function() {
      var obj = { type: proto.RESULT }
      expect(bindEncode(obj)).to.throw(Error)
      obj.requestId = null
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should throw on invalid results list', function() {
      var obj = { type: proto.RESULT
                , requestId: 'coolId'
                , results: 7
                }
      expect(bindEncode(obj)).to.throw(Error)
      obj.results = 'test'
      expect(bindEncode(obj)).to.throw(Error)
      obj.results = { test: true }
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should encode an object with no results', function() {
      var obj = { type: proto.RESULT, requestId: 'coolId' }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal([ proto.RESULT, 'coolId' ])
    })

    it('should encode an object with empty results list', function() {
      var obj = { type: proto.RESULT, requestId: 'coolId', results: [] }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal([ proto.RESULT, 'coolId' ])
    })

    it('should encode an object with results', function() {
      var obj = { type: proto.RESULT
                , requestId: 'coolId'
                , results:  [ 7
                            , { test: true }
                            , 'test'
                            , [ 'arrays' ]
                            ]
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.RESULT
                                                , 'coolId'
                                                , 7
                                                , { test: true }
                                                , 'test'
                                                , [ 'arrays' ]
                                                ])
    })

    it('should coerce values to the correct type', function() {
      var obj = { type: proto.RESULT, requestId: 7 }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal([ proto.RESULT, '7' ])
    })
  })

  describe('#encode(ERROR)', function() {
    it('should throw on incomplete objects', function() {
      var obj = { type: proto.ERROR
                , errorCode: 404
                , errorDesc: 'not found'
                }
      expect(bindEncode(obj)).to.throw(Error)
      obj.requestId = null
      expect(bindEncode(obj)).to.throw(Error)
      obj.requestId = 'coolId'
      obj.errorCode = null
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.errorCode
      expect(bindEncode(obj)).to.throw(Error)
      obj.errorCode = 404
      obj.errorDesc = null
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.errorDesc
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should throw on non-numeric error codes', function() {
      var obj = { type: proto.ERROR
                , requestId: 'coolId'
                , errorCode: 'a'
                , errorDesc: 'wat'
                }
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should encode an object without errorDetails', function() {
      var obj = { type: proto.ERROR
                , requestId: 'coolId'
                , errorCode: 404
                , errorDesc: 'not found'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.ERROR
                                                , 'coolId'
                                                , 404
                                                , 'not found'
                                                ])
    })

    it('should encode an object with errorDetails', function() {
      var obj = { type: proto.ERROR
                , requestId: 'coolId'
                , errorCode: 404
                , errorDesc: 'not found'
                , errorDetails: { message: '/test/path could not be found' }
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.ERROR
                                                , 'coolId'
                                                , 404
                                                , 'not found'
                                                , { message: '/test/path could not be found' }
                                                ])
    })

    it('should coerce values to the correct type', function() {
      var obj = { type: proto.ERROR
                , requestId: 7
                , errorCode: 404
                , errorDesc: 7
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.ERROR
                                                , '7'
                                                , 404
                                                , '7'
                                                ])
    })
  })

  describe('#encode(SUBSCRIBE)', function() {
    it('should throw on incomplete objects', function() {
      var obj = { type: proto.SUBSCRIBE
                , requestId: null
                , topicPath: '/test/path'
                }
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.requestId
      expect(bindEncode(obj)).to.throw(Error)
      obj.requestId = 'coolId'
      obj.topicPath = null
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.topicPath
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should encode valid objects', function() {
      var obj = { type: proto.SUBSCRIBE
                , requestId: 'coolId'
                , topicPath: '/test/path'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.SUBSCRIBE
                                                , 'coolId'
                                                , '/test/path'
                                                ])
    })

    it('should coerce values to proper types', function() {
      var obj = { type: proto.SUBSCRIBE
                , requestId: 7
                , topicPath: 7
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.SUBSCRIBE
                                                , '7'
                                                , '7'
                                                ])
    })
  })

  describe('#encode(UNSUBSCRIBE)', function() {
    it('should throw on incomplete objects', function() {
      expect(bindEncode({ type: proto.UNSUBSCRIBE })).to.throw(Error)
      expect(bindEncode({ type: proto.UNSUBSCRIBE, requestId: 'coolId' })).to.throw(Error)
      expect(bindEncode({ type: proto.UNSUBSCRIBE, topicPath: '/test/path' })).to.throw(Error)
    })

    it('should encode valid objects', function() {
      var obj = { type: proto.UNSUBSCRIBE
                , requestId: 'coolId'
                , topicPath: '/test/path'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal([ proto.UNSUBSCRIBE, 'coolId', '/test/path' ])
    })

    it('should coerce values to the correct type', function() {
      var obj = { type: proto.UNSUBSCRIBE
                , requestId: 7
                , topicPath: 7
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal([ proto.UNSUBSCRIBE, '7', '7' ])
    })
  })

  describe('#encode(PUBLISH)', function() {
    it('should throw on incomplete objects', function() {
      var obj = { type: proto.PUBLISH
                , topicPath: null
                , event: 'test'
                }
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.topicPath
      expect(bindEncode(obj)).to.throw(Error)
      obj.topicPath = '/test/path'
      delete obj.event
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should encode valid objects without excludeMe', function() {
      var obj = { type: proto.PUBLISH
                , topicPath: '/test/path'
                , event: 'test'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.PUBLISH
                                                , '/test/path'
                                                , 'test'
                                                ])
    })

    it('should encode valid objects with excludeMe', function() {
      var obj = { type: proto.PUBLISH
                , topicPath: '/test/path'
                , event: 'test'
                , excludeMe: true
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.PUBLISH
                                                , '/test/path'
                                                , 'test'
                                                , true
                                                ])
      obj.excludeMe = false
      result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.PUBLISH
                                                , '/test/path'
                                                , 'test'
                                                ])
    })

    it('should allow nulls for event', function() {
      var obj = { type: proto.PUBLISH
                , topicPath: '/test/path'
                , event: null
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.PUBLISH
                                                , '/test/path'
                                                , null
                                                ])
    })

    it('should coerce values to the proper type', function() {
      var obj = { type: proto.PUBLISH
                , topicPath: 7
                , event: 'blah'
                , excludeMe: 1
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.PUBLISH
                                                , '7'
                                                , 'blah'
                                                , true
                                                ])
    })
  })

  describe('#encode(EVENT)', function() {
    it('should throw on incomplete objects', function() {
      var obj = { type: proto.EVENT
                , topicPath: null
                , event: 'test'
                }
      expect(bindEncode(obj)).to.throw(Error)
      delete obj.topicPath
      expect(bindEncode(obj)).to.throw(Error)
      obj.topicPath = '/test/path'
      delete obj.event
      expect(bindEncode(obj)).to.throw(Error)
    })

    it('should encode valid objects', function() {
      var obj = { type: proto.EVENT
                , topicPath: '/test/path'
                , event: 'test'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.EVENT
                                                , '/test/path'
                                                , 'test'
                                                ])
    })

    it('should allow nulls for event', function() {
      var obj = { type: proto.EVENT
                , topicPath: '/test/path'
                , event: null
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.EVENT
                                                , '/test/path'
                                                , null
                                                ])
    })

    it('should coerce values to the correct type', function() {
      var obj = { type: proto.EVENT
                , topicPath: 7
                , event: 'test'
                }
        , result = proto.encode(obj)
      expect(JSON.parse(result)).to.deep.equal( [ proto.EVENT
                                                , '7'
                                                , 'test'
                                                ])
    })
  })

  describe('nydus-protocol', function() {
    it('should isomorphically encode/decode WELCOME', function() {
      var obj = { type: proto.WELCOME
                , serverAgent: 'AwesomeServer/1.0.1'
                }
        , result = proto.decode(proto.encode(obj))
      obj.protocolVersion = proto.protocolVersion // not necessary to encode, but added in encoding
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode CALL', function() {
      var obj = { type: proto.CALL
                , requestId: 'coolId'
                , procPath: '/test/path'
                , params: [ [ 'test', 'cool', 'params', 'bro' ], 'yeah', 7 ]
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode RESULT', function() {
      var obj = { type: proto.RESULT
                , requestId: 'coolId'
                , results: [ [ 'cool', 'results', 'bro'], 'yeah', 7 ]
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode ERROR', function() {
      var obj = { type: proto.ERROR
                , requestId: 'coolId'
                , errorCode: 404
                , errorDesc: 'not found'
                , errorDetails: { message: 'sorry not found try later thx' }
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode SUBSCRIBE', function() {
      var obj = { type: proto.SUBSCRIBE
                , requestId: 'coolId'
                , topicPath: '/test/path'
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode UNSUBSCRIBE', function() {
      var obj = { type: proto.UNSUBSCRIBE
                , requestId: 'coolId'
                , topicPath: '/test/path'
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode PUBLISH', function() {
      var obj = { type: proto.PUBLISH
                , topicPath: '/test/path'
                , event: null
                , excludeMe: true
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })

    it('should isomorphically encode/decode EVENT', function() {
      var obj = { type: proto.EVENT
                , topicPath: '/test/path'
                , event: null
                }
        , result = proto.decode(proto.encode(obj))
      expect(result).to.deep.equal(obj)
      expect(proto.encode(obj)).to.eql(proto.encode(result))
    })
  })
})
