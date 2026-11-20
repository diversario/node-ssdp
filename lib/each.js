'use strict'

/**
 * Calls `fn(item, next)` for every item, without waiting between the items.
 *
 * Calls `done(null)` when every `next` was called. Calls `done(err)` as soon
 * as one `next` gets an error. `done` is called one time.
 *
 * @param {Array} items
 * @param {Function} fn
 * @param {Function} done
 */
module.exports = function each(items, fn, done) {
  var pending = items.length
    , finished = false

  if (pending === 0) return done(null)

  items.forEach(function (item) {
    fn(item, function (err) {
      if (finished) return

      if (err || --pending === 0) {
        finished = true
        done(err || null)
      }
    })
  })
}
