(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.db = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
    'use strict';

    var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

    var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

    function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

    (function (local) {
      'use strict';

      var IDBKeyRange = local.IDBKeyRange || local.webkitIDBKeyRange;
      var transactionModes = {
        readonly: 'readonly',
        readwrite: 'readwrite'
      };
      var hasOwn = Object.prototype.hasOwnProperty;
      var defaultMapper = function defaultMapper(x) {
        return x;
      };

      var indexedDB = local.indexedDB || local.webkitIndexedDB || local.mozIndexedDB || local.oIndexedDB || local.msIndexedDB || local.shimIndexedDB || function () {
        throw new Error('IndexedDB required');
      }();

      var dbCache = {};
      var serverEvents = ['abort', 'error', 'versionchange'];

      function isObject(item) {
        return item && (typeof item === 'undefined' ? 'undefined' : _typeof(item)) === 'object';
      }

      function mongoDBToKeyRangeArgs(opts) {
        var keys = Object.keys(opts).sort();
        if (keys.length === 1) {
          var key = keys[0];
          var val = opts[key];
          var name = void 0,
            inclusive = void 0;
          switch (key) {
            case 'eq':
              name = 'only';break;
            case 'gt':
              name = 'lowerBound';
              inclusive = true;
              break;
            case 'lt':
              name = 'upperBound';
              inclusive = true;
              break;
            case 'gte':
              name = 'lowerBound';break;
            case 'lte':
              name = 'upperBound';break;
            default:
              throw new TypeError('`' + key + '` is not a valid key');
          }
          return [name, [val, inclusive]];
        }
        var x = opts[keys[0]];
        var y = opts[keys[1]];
        var pattern = keys.join('-');

        switch (pattern) {
          case 'gt-lt':case 'gt-lte':case 'gte-lt':case 'gte-lte':
          return ['bound', [x, y, keys[0] === 'gt', keys[1] === 'lt']];
          default:
            throw new TypeError('`' + pattern + '` are conflicted keys');
        }
      }
      function mongoifyKey(key) {
        if (key && (typeof key === 'undefined' ? 'undefined' : _typeof(key)) === 'object' && !(key instanceof IDBKeyRange)) {
          var _mongoDBToKeyRangeArg = mongoDBToKeyRangeArgs(key);

          var _mongoDBToKeyRangeArg2 = _slicedToArray(_mongoDBToKeyRangeArg, 2);

          var type = _mongoDBToKeyRangeArg2[0];
          var args = _mongoDBToKeyRangeArg2[1];

          return IDBKeyRange[type].apply(IDBKeyRange, _toConsumableArray(args));
        }
        return key;
      }

      var IndexQuery = function IndexQuery(table, db, indexName, preexistingError) {
        var _this = this;

        var modifyObj = null;

        var runQuery = function runQuery(type, args, cursorType, direction, limitRange, filters, mapper) {
          return new Promise(function (resolve, reject) {
            var keyRange = void 0;
            try {
              keyRange = type ? IDBKeyRange[type].apply(IDBKeyRange, _toConsumableArray(args)) : null;
            } catch (e) {
              reject(e);
              return;
            }
            filters = filters || [];
            limitRange = limitRange || null;

            var results = [];
            var counter = 0;
            var indexArgs = [keyRange];

            var transaction = db.transaction(table, modifyObj ? transactionModes.readwrite : transactionModes.readonly);
            transaction.onerror = function (e) {
              return reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };
            transaction.oncomplete = function () {
              return resolve(results);
            };

            var store = transaction.objectStore(table); // if bad, db.transaction will reject first
            var index = typeof indexName === 'string' ? store.index(indexName) : store;

            if (cursorType !== 'count') {
              indexArgs.push(direction || 'next');
            }

            // Create a function that will set in the modifyObj properties into
            // the passed record.
            var modifyKeys = modifyObj ? Object.keys(modifyObj) : [];

            var modifyRecord = function modifyRecord(record) {
              modifyKeys.forEach(function (key) {
                var val = modifyObj[key];
                if (typeof val === 'function') {
                  val = val(record);
                }
                record[key] = val;
              });
              return record;
            };

            index[cursorType].apply(index, indexArgs).onsuccess = function (e) {
              // indexArgs are already validated
              var cursor = e.target.result;
              if (typeof cursor === 'number') {
                results = cursor;
              } else if (cursor) {
                if (limitRange !== null && limitRange[0] > counter) {
                  counter = limitRange[0];
                  cursor.advance(limitRange[0]); // Will throw on 0, but condition above prevents since counter always 0+
                } else if (limitRange !== null && counter >= limitRange[0] + limitRange[1]) {
                  // Out of limit range... skip
                } else {
                  var _ret = function () {
                    var matchFilter = true;
                    var result = 'value' in cursor ? cursor.value : cursor.key;

                    try {
                      filters.forEach(function (filter) {
                        if (typeof filter[0] === 'function') {
                          matchFilter = matchFilter && filter[0](result);
                        } else {
                          matchFilter = matchFilter && result[filter[0]] === filter[1];
                        }
                      });
                    } catch (err) {
                      // Could be filter on non-object or error in filter function
                      reject(err);
                      return {
                        v: void 0
                      };
                    }

                    if (matchFilter) {
                      counter++;
                      // If we're doing a modify, run it now
                      if (modifyObj) {
                        try {
                          result = modifyRecord(result);
                          cursor.update(result); // `result` should only be a "structured clone"-able object
                        } catch (err) {
                          reject(err);
                          return {
                            v: void 0
                          };
                        }
                      }
                      try {
                        results.push(mapper(result));
                      } catch (err) {
                        reject(err);
                        return {
                          v: void 0
                        };
                      }
                    }
                    cursor.continue();
                  }();

                  if ((typeof _ret === 'undefined' ? 'undefined' : _typeof(_ret)) === "object") return _ret.v;
                }
              }
            };
          });
        };

        var Query = function Query(type, args, queuedError) {
          var filters = [];
          var direction = 'next';
          var cursorType = 'openCursor';
          var limitRange = null;
          var mapper = defaultMapper;
          var unique = false;
          var error = preexistingError || queuedError;

          var execute = function execute() {
            if (error) {
              return Promise.reject(error);
            }
            return runQuery(type, args, cursorType, unique ? direction + 'unique' : direction, limitRange, filters, mapper);
          };

          var count = function count() {
            direction = null;
            cursorType = 'count';

            return {
              execute: execute
            };
          };

          var keys = function keys() {
            cursorType = 'openKeyCursor';

            return {
              desc: desc,
              distinct: distinct,
              execute: execute,
              filter: filter,
              limit: limit,
              map: map
            };
          };

          var limit = function limit(start, end) {
            limitRange = !end ? [0, start] : [start, end];
            error = limitRange.some(function (val) {
              return typeof val !== 'number';
            }) ? new Error('limit() arguments must be numeric') : error;

            return {
              desc: desc,
              distinct: distinct,
              filter: filter,
              keys: keys,
              execute: execute,
              map: map,
              modify: modify
            };
          };

          var filter = function filter(prop, val) {
            filters.push([prop, val]);

            return {
              desc: desc,
              distinct: distinct,
              execute: execute,
              filter: filter,
              keys: keys,
              limit: limit,
              map: map,
              modify: modify
            };
          };

          var desc = function desc() {
            direction = 'prev';

            return {
              distinct: distinct,
              execute: execute,
              filter: filter,
              keys: keys,
              limit: limit,
              map: map,
              modify: modify
            };
          };

          var distinct = function distinct() {
            unique = true;
            return {
              count: count,
              desc: desc,
              execute: execute,
              filter: filter,
              keys: keys,
              limit: limit,
              map: map,
              modify: modify
            };
          };

          var modify = function modify(update) {
            modifyObj = update && (typeof update === 'undefined' ? 'undefined' : _typeof(update)) === 'object' ? update : null;
            return {
              execute: execute
            };
          };

          var map = function map(fn) {
            mapper = fn;

            return {
              count: count,
              desc: desc,
              distinct: distinct,
              execute: execute,
              filter: filter,
              keys: keys,
              limit: limit,
              modify: modify
            };
          };

          return {
            count: count,
            desc: desc,
            distinct: distinct,
            execute: execute,
            filter: filter,
            keys: keys,
            limit: limit,
            map: map,
            modify: modify
          };
        };

        ['only', 'bound', 'upperBound', 'lowerBound'].forEach(function (name) {
          _this[name] = function () {
            return Query(name, arguments);
          };
        });

        this.range = function (opts) {
          var error = void 0;
          var keyRange = [null, null];
          try {
            keyRange = mongoDBToKeyRangeArgs(opts);
          } catch (e) {
            error = e;
          }
          return Query.apply(undefined, _toConsumableArray(keyRange).concat([error]));
        };

        this.filter = function () {
          var query = Query(null, null);
          return query.filter.apply(query, arguments);
        };

        this.all = function () {
          return this.filter();
        };
      };

      var Server = function Server(db, name, version, noServerMethods) {
        var _this2 = this;

        var closed = false;

        this.getIndexedDB = function () {
          return db;
        };
        this.isClosed = function () {
          return closed;
        };

        this.query = function (table, index) {
          var error = closed ? new Error('Database has been closed') : null;
          return new IndexQuery(table, db, index, error); // Does not throw by itself
        };

        this.add = function (table) {
          for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
            args[_key - 1] = arguments[_key];
          }

          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }

            var records = args.reduce(function (records, aip) {
              return records.concat(aip);
            }, []);

            var transaction = db.transaction(table, transactionModes.readwrite);
            transaction.onerror = function (e) {
              // prevent throwing a ConstraintError and aborting (hard)
              // https://bugzilla.mozilla.org/show_bug.cgi?id=872873
              e.preventDefault();
              reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };
            transaction.oncomplete = function () {
              return resolve(records);
            };

            var store = transaction.objectStore(table);
            records.some(function (record) {
              var req = void 0,
                key = void 0;
              if (isObject(record) && hasOwn.call(record, 'item')) {
                key = record.key;
                record = record.item;
                if (key != null) {
                  try {
                    key = mongoifyKey(key);
                  } catch (e) {
                    reject(e);
                    return true;
                  }
                }
              }

              try {
                // Safe to add since in readwrite
                if (key != null) {
                  req = store.add(record, key);
                } else {
                  req = store.add(record);
                }
              } catch (e) {
                reject(e);
                return true;
              }

              req.onsuccess = function (e) {
                if (!isObject(record)) {
                  return;
                }
                var target = e.target;
                var keyPath = target.source.keyPath;
                if (keyPath === null) {
                  keyPath = '__id__';
                }
                if (hasOwn.call(record, keyPath)) {
                  return;
                }
                Object.defineProperty(record, keyPath, {
                  value: target.result,
                  enumerable: true
                });
              };
            });
          });
        };

        this.update = function (table) {
          for (var _len2 = arguments.length, args = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
            args[_key2 - 1] = arguments[_key2];
          }

          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }

            var records = args.reduce(function (records, aip) {
              return records.concat(aip);
            }, []);

            var transaction = db.transaction(table, transactionModes.readwrite);
            transaction.onerror = function (e) {
              // prevent throwing aborting (hard)
              // https://bugzilla.mozilla.org/show_bug.cgi?id=872873
              e.preventDefault();
              reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };
            transaction.oncomplete = function () {
              return resolve(records);
            };

            var store = transaction.objectStore(table);

            records.some(function (record) {
              var req = void 0,
                key = void 0;
              if (isObject(record) && hasOwn.call(record, 'item')) {
                key = record.key;
                record = record.item;
                if (key != null) {
                  try {
                    key = mongoifyKey(key);
                  } catch (e) {
                    reject(e);
                    return true;
                  }
                }
              }
              try {
                // These can throw DataError, e.g., if function passed in
                if (key != null) {
                  req = store.put(record, key);
                } else {
                  req = store.put(record);
                }
              } catch (err) {
                reject(err);
                return true;
              }

              req.onsuccess = function (e) {
                if (!isObject(record)) {
                  return;
                }
                var target = e.target;
                var keyPath = target.source.keyPath;
                if (keyPath === null) {
                  keyPath = '__id__';
                }
                if (hasOwn.call(record, keyPath)) {
                  return;
                }
                Object.defineProperty(record, keyPath, {
                  value: target.result,
                  enumerable: true
                });
              };
            });
          });
        };

        this.put = function () {
          return this.update.apply(this, arguments);
        };

        this.remove = function (table, key) {
          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }
            try {
              key = mongoifyKey(key);
            } catch (e) {
              reject(e);
              return;
            }

            var transaction = db.transaction(table, transactionModes.readwrite);
            transaction.onerror = function (e) {
              // prevent throwing and aborting (hard)
              // https://bugzilla.mozilla.org/show_bug.cgi?id=872873
              e.preventDefault();
              reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };
            transaction.oncomplete = function () {
              return resolve(key);
            };

            var store = transaction.objectStore(table);
            try {
              store.delete(key);
            } catch (err) {
              reject(err);
            }
          });
        };

        this.delete = function () {
          return this.remove.apply(this, arguments);
        };

        this.clear = function (table) {
          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }
            var transaction = db.transaction(table, transactionModes.readwrite);
            transaction.onerror = function (e) {
              return reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };
            transaction.oncomplete = function () {
              return resolve();
            };

            var store = transaction.objectStore(table);
            store.clear();
          });
        };

        this.close = function () {
          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }
            db.close();
            closed = true;
            delete dbCache[name][version];
            resolve();
          });
        };

        this.get = function (table, key) {
          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }
            try {
              key = mongoifyKey(key);
            } catch (e) {
              reject(e);
              return;
            }

            var transaction = db.transaction(table);
            transaction.onerror = function (e) {
              // prevent throwing and aborting (hard)
              // https://bugzilla.mozilla.org/show_bug.cgi?id=872873
              e.preventDefault();
              reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };

            var store = transaction.objectStore(table);

            var req = void 0;
            try {
              req = store.get(key);
            } catch (err) {
              reject(err);
            }
            req.onsuccess = function (e) {
              return resolve(e.target.result);
            };
          });
        };

        this.count = function (table, key) {
          return new Promise(function (resolve, reject) {
            if (closed) {
              reject(new Error('Database has been closed'));
              return;
            }
            try {
              key = mongoifyKey(key);
            } catch (e) {
              reject(e);
              return;
            }

            var transaction = db.transaction(table);
            transaction.onerror = function (e) {
              // prevent throwing and aborting (hard)
              // https://bugzilla.mozilla.org/show_bug.cgi?id=872873
              e.preventDefault();
              reject(e);
            };
            transaction.onabort = function (e) {
              return reject(e);
            };

            var store = transaction.objectStore(table);
            var req = void 0;
            try {
              req = key == null ? store.count() : store.count(key);
            } catch (err) {
              reject(err);
            }
            req.onsuccess = function (e) {
              return resolve(e.target.result);
            };
          });
        };

        this.addEventListener = function (eventName, handler) {
          if (!serverEvents.includes(eventName)) {
            throw new Error('Unrecognized event type ' + eventName);
          }
          if (eventName === 'error') {
            db.addEventListener(eventName, function (e) {
              e.preventDefault(); // Needed by Firefox to prevent hard abort with ConstraintError
              handler(e);
            });
            return;
          }
          db.addEventListener(eventName, handler);
        };

        this.removeEventListener = function (eventName, handler) {
          if (!serverEvents.includes(eventName)) {
            throw new Error('Unrecognized event type ' + eventName);
          }
          db.removeEventListener(eventName, handler);
        };

        serverEvents.forEach(function (evName) {
          this[evName] = function (handler) {
            this.addEventListener(evName, handler);
            return this;
          };
        }, this);

        if (noServerMethods) {
          return;
        }

        var err = void 0;
        [].some.call(db.objectStoreNames, function (storeName) {
          if (_this2[storeName]) {
            err = new Error('The store name, "' + storeName + '", which you have attempted to load, conflicts with db.js method names."');
            _this2.close();
            return true;
          }
          _this2[storeName] = {};
          var keys = Object.keys(_this2);
          keys.filter(function (key) {
            return ![].concat(serverEvents, ['close', 'addEventListener', 'removeEventListener']).includes(key);
          }).map(function (key) {
            return _this2[storeName][key] = function () {
              for (var _len3 = arguments.length, args = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
                args[_key3] = arguments[_key3];
              }

              return _this2[key].apply(_this2, [storeName].concat(args));
            };
          });
        });
        return err;
      };

      var createSchema = function createSchema(e, request, schema, db, server, version) {
        if (!schema || schema.length === 0) {
          return;
        }

        for (var i = 0; i < db.objectStoreNames.length; i++) {
          var name = db.objectStoreNames[i];
          if (!hasOwn.call(schema, name)) {
            // Errors for which we are not concerned and why:
            // `InvalidStateError` - We are in the upgrade transaction.
            // `TransactionInactiveError` (as by the upgrade having already
            //      completed or somehow aborting) - since we've just started and
            //      should be without risk in this loop
            // `NotFoundError` - since we are iterating the dynamically updated
            //      `objectStoreNames`
            db.deleteObjectStore(name);
          }
        }

        var ret = void 0;
        Object.keys(schema).some(function (tableName) {
          var table = schema[tableName];
          var store = void 0;
          if (db.objectStoreNames.contains(tableName)) {
            store = request.transaction.objectStore(tableName); // Shouldn't throw
          } else {
            // Errors for which we are not concerned and why:
            // `InvalidStateError` - We are in the upgrade transaction.
            // `ConstraintError` - We are just starting (and probably never too large anyways) for a key generator.
            // `ConstraintError` - The above condition should prevent the name already existing.
            //
            // Possible errors:
            // `TransactionInactiveError` - if the upgrade had already aborted,
            //      e.g., from a previous `QuotaExceededError` which is supposed to nevertheless return
            //      the store but then abort the transaction.
            // `SyntaxError` - if an invalid `table.key.keyPath` is supplied.
            // `InvalidAccessError` - if `table.key.autoIncrement` is `true` and `table.key.keyPath` is an
            //      empty string or any sequence (empty or otherwise).
            try {
              store = db.createObjectStore(tableName, table.key);
            } catch (err) {
              ret = err;
              return true;
            }
          }

          Object.keys(table.indexes || {}).some(function (indexKey) {
            try {
              store.index(indexKey);
            } catch (err) {
              var index = table.indexes[indexKey];
              index = index && (typeof index === 'undefined' ? 'undefined' : _typeof(index)) === 'object' ? index : {};
              // Errors for which we are not concerned and why:
              // `InvalidStateError` - We are in the upgrade transaction and store found above should not have already been deleted.
              // `ConstraintError` - We have already tried getting the index, so it shouldn't already exist
              //
              // Possible errors:
              // `TransactionInactiveError` - if the upgrade had already aborted,
              //      e.g., from a previous `QuotaExceededError` which is supposed to nevertheless return
              //      the index object but then abort the transaction.
              // `SyntaxError` - If the `keyPath` (second argument) is an invalid key path
              // `InvalidAccessError` - If `multiEntry` on `index` is `true` and
              //                          `keyPath` (second argument) is a sequence
              try {
                store.createIndex(indexKey, index.keyPath || index.key || indexKey, index);
              } catch (err2) {
                ret = err2;
                return true;
              }
            }
          });
        });
        return ret;
      };

      var _open = function _open(e, server, version, noServerMethods) {
        var db = e.target.result;
        dbCache[server][version] = db;

        var s = new Server(db, server, version, noServerMethods);
        return s instanceof Error ? Promise.reject(s) : Promise.resolve(s);
      };

      var db = {
        version: '0.15.0',
        open: function open(options) {
          var server = options.server;
          var version = options.version || 1;
          var schema = options.schema;
          var noServerMethods = options.noServerMethods;

          if (!dbCache[server]) {
            dbCache[server] = {};
          }
          return new Promise(function (resolve, reject) {
            if (dbCache[server][version]) {
              _open({
                target: {
                  result: dbCache[server][version]
                }
              }, server, version, noServerMethods).then(resolve, reject);
            } else {
              var _ret2 = function () {
                if (typeof schema === 'function') {
                  try {
                    schema = schema();
                  } catch (e) {
                    reject(e);
                    return {
                      v: void 0
                    };
                  }
                }
                var request = indexedDB.open(server, version);

                request.onsuccess = function (e) {
                  return _open(e, server, version, noServerMethods).then(resolve, reject);
                };
                request.onerror = function (e) {
                  // Prevent default for `BadVersion` and `AbortError` errors, etc.
                  // These are not necessarily reported in console in Chrome but present; see
                  //  https://bugzilla.mozilla.org/show_bug.cgi?id=872873
                  //  http://stackoverflow.com/questions/36225779/aborterror-within-indexeddb-upgradeneeded-event/36266502
                  e.preventDefault();
                  reject(e);
                };
                request.onupgradeneeded = function (e) {
                  var err = createSchema(e, request, schema, e.target.result, server, version);
                  if (err) {
                    reject(err);
                  }
                };
                request.onblocked = function (e) {
                  var resume = new Promise(function (res, rej) {
                    // We overwrite handlers rather than make a new
                    //   open() since the original request is still
                    //   open and its onsuccess will still fire if
                    //   the user unblocks by closing the blocking
                    //   connection
                    request.onsuccess = function (ev) {
                      _open(ev, server, version, noServerMethods).then(res, rej);
                    };
                    request.onerror = function (e) {
                      return rej(e);
                    };
                  });
                  e.resume = resume;
                  reject(e);
                };
              }();

              if ((typeof _ret2 === 'undefined' ? 'undefined' : _typeof(_ret2)) === "object") return _ret2.v;
            }
          });
        },

        delete: function _delete(dbName) {
          return new Promise(function (resolve, reject) {
            var request = indexedDB.deleteDatabase(dbName); // Does not throw

            request.onsuccess = function (e) {
              return resolve(e);
            };
            request.onerror = function (e) {
              return reject(e);
            }; // No errors currently
            request.onblocked = function (e) {
              // The following addresses part of https://bugzilla.mozilla.org/show_bug.cgi?id=1220279
              e = e.newVersion === null || typeof Proxy === 'undefined' ? e : new Proxy(e, { get: function get(target, name) {
                  return name === 'newVersion' ? null : target[name];
                } });
              var resume = new Promise(function (res, rej) {
                // We overwrite handlers rather than make a new
                //   delete() since the original request is still
                //   open and its onsuccess will still fire if
                //   the user unblocks by closing the blocking
                //   connection
                request.onsuccess = function (ev) {
                  // The following are needed currently by PhantomJS: https://github.com/ariya/phantomjs/issues/14141
                  if (!('newVersion' in ev)) {
                    ev.newVersion = e.newVersion;
                  }

                  if (!('oldVersion' in ev)) {
                    ev.oldVersion = e.oldVersion;
                  }

                  res(ev);
                };
                request.onerror = function (e) {
                  return rej(e);
                };
              });
              e.resume = resume;
              reject(e);
            };
          });
        },

        cmp: function cmp(param1, param2) {
          return new Promise(function (resolve, reject) {
            try {
              resolve(indexedDB.cmp(param1, param2));
            } catch (e) {
              reject(e);
            }
          });
        }
      };

      if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = db;
      } else if (typeof define === 'function' && define.amd) {
        define(function () {
          return db;
        });
      } else {
        local.db = db;
      }
    })(self);


  },{}]},{},[1])(1)
});