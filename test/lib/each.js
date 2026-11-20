var assert = require('assert')

var each = require('../../lib/each')

describe('each helper', function () {
  it('calls done when every item is finished', function () {
    var nexts = []
      , results = []

    each(['a', 'b'], function (item, next) {
      nexts.push(next)
    }, function (err) {
      results.push(err)
    })

    // every item is started before one is finished
    assert.equal(nexts.length, 2)

    nexts[1]()
    assert.deepStrictEqual(results, [])

    nexts[0]()
    assert.deepStrictEqual(results, [null])
  })

  it('calls done at once for an empty list', function () {
    var results = []

    each([], function () {
      throw new Error('there is no item')
    }, function (err) {
      results.push(err)
    })

    assert.deepStrictEqual(results, [null])
  })

  it('calls done one time, with the first error', function () {
    var nexts = []
      , results = []
      , error = new Error('first')

    each(['a', 'b', 'c'], function (item, next) {
      nexts.push(next)
    }, function (err) {
      results.push(err)
    })

    nexts[1](error)
    nexts[0](new Error('second'))
    nexts[2]()

    assert.deepStrictEqual(results, [error])
  })
})
