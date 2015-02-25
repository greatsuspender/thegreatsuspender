//The MIT License
//Copyright (c) 2012 Aaron Powell

(function ( window , undefined ) {
    'use strict';

    var indexedDB,
        IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange,
        transactionModes = {
            readonly: 'readonly',
            readwrite: 'readwrite'
        };

    var hasOwn = Object.prototype.hasOwnProperty;

    var getIndexedDB = function() {
      if ( !indexedDB ) {
        indexedDB = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.oIndexedDB || window.msIndexedDB;

        if ( !indexedDB ) {
          throw 'IndexedDB required';
        }
      }
      return indexedDB;
    };

    var defaultMapper = function (value) {
        return value;
    };

    var CallbackList = function () {
        var state,
            list = [];

        var exec = function ( context , args ) {
            if ( list ) {
                args = args || [];
                state = state || [ context , args ];

                for ( var i = 0 , il = list.length ; i < il ; i++ ) {
                    list[ i ].apply( state[ 0 ] , state[ 1 ] );
                }

                list = [];
            }
        };

        this.add = function () {
            for ( var i = 0 , il = arguments.length ; i < il ; i ++ ) {
                list.push( arguments[ i ] );
            }

            if ( state ) {
                exec();
            }

            return this;
        };

        this.execute = function () {
            exec( this , arguments );
            return this;
        };
    };

    var Server = function ( db , name ) {
        var that = this,
            closed = false;

        this.add = function( table ) {
            if ( closed ) {
                throw 'Database has been closed';
            }

            var records = [];
            var counter = 0;

            for (var i = 0; i < arguments.length - 1; i++) {
                if (Array.isArray(arguments[i + 1])) {
                    for (var j = 0; j < (arguments[i + 1]).length; j++) {
                        records[counter] = (arguments[i + 1])[j];
                        counter++;
                    }
                } else {
                    records[counter] = arguments[i + 1];
                    counter++;
                }
            }

            var transaction = db.transaction( table , transactionModes.readwrite ),
                store = transaction.objectStore( table );

            return new Promise(function(resolve, reject){
              records.forEach( function ( record ) {
                  var req;
                  if ( record.item && record.key ) {
                      var key = record.key;
                      record = record.item;
                      req = store.add( record , key );
                  } else {
                      req = store.add( record );
                  }

                  req.onsuccess = function ( e ) {
                      var target = e.target;
                      var keyPath = target.source.keyPath;
                      if ( keyPath === null ) {
                          keyPath = '__id__';
                      }
                      Object.defineProperty( record , keyPath , {
                          value: target.result,
                          enumerable: true
                      });
                  };
              } );

              transaction.oncomplete = function () {
                  resolve( records , that );
              };
              transaction.onerror = function ( e ) {
                  reject( e );
              };
              transaction.onabort = function ( e ) {
                  reject( e );
              };

            });
        };

        this.update = function( table ) {
            if ( closed ) {
                throw 'Database has been closed';
            }

            var records = [];
            for ( var i = 0 ; i < arguments.length - 1 ; i++ ) {
                records[ i ] = arguments[ i + 1 ];
            }

            var transaction = db.transaction( table , transactionModes.readwrite ),
                store = transaction.objectStore( table ),
                keyPath = store.keyPath;

            return new Promise(function(resolve, reject){
              records.forEach( function ( record ) {
                  var req;
                  var count;
                  if ( record.item && record.key ) {
                      var key = record.key;
                      record = record.item;
                      req = store.put( record , key );
                  } else {
                      req = store.put( record );
                  }

                  req.onsuccess = function ( e ) {
                      // deferred.notify(); es6 promise can't notify
                  };
              } );

              transaction.oncomplete = function () {
                  resolve( records , that );
              };
              transaction.onerror = function ( e ) {
                  reject( e );
              };
              transaction.onabort = function ( e ) {
                  reject( e );
              };
            });

        };

        this.remove = function ( table , key ) {
            if ( closed ) {
                throw 'Database has been closed';
            }
            var transaction = db.transaction( table , transactionModes.readwrite ),
                store = transaction.objectStore( table );

            return new Promise(function(resolve, reject){
              var req = store['delete']( key );
              transaction.oncomplete = function ( ) {
                  resolve( key );
              };
              transaction.onerror = function ( e ) {
                  reject( e );
              };
            });
        };

        this.clear = function ( table ) {
            if ( closed ) {
                throw 'Database has been closed';
            }
            var transaction = db.transaction( table , transactionModes.readwrite ),
                store = transaction.objectStore( table );

            var req = store.clear();
            return new Promise(function(resolve, reject){
              transaction.oncomplete = function ( ) {
                  resolve( );
              };
              transaction.onerror = function ( e ) {
                  reject( e );
              };
            });
        };

        this.close = function ( ) {
            if ( closed ) {
                throw 'Database has been closed';
            }
            db.close();
            closed = true;
            delete dbCache[ name ];
        };

        this.get = function ( table , id ) {
            if ( closed ) {
                throw 'Database has been closed';
            }
            var transaction = db.transaction( table ),
                store = transaction.objectStore( table );

            var req = store.get( id );
            return new Promise(function(resolve, reject){
              req.onsuccess = function ( e ) {
                  resolve( e.target.result );
              };
              transaction.onerror = function ( e ) {
                  reject( e );
              };
            });
        };

        this.query = function ( table , index ) {
            if ( closed ) {
                throw 'Database has been closed';
            }
            return new IndexQuery( table , db , index );
        };

        for ( var i = 0 , il = db.objectStoreNames.length ; i < il ; i++ ) {
            (function ( storeName ) {
                that[ storeName ] = { };
                for ( var i in that ) {
                    if ( !hasOwn.call( that , i ) || i === 'close' ) {
                        continue;
                    }
                    that[ storeName ][ i ] = (function ( i ) {
                        return function () {
                            var args = [ storeName ].concat( [].slice.call( arguments , 0 ) );
                            return that[ i ].apply( that , args );
                        };
                    })( i );
                }
            })( db.objectStoreNames[ i ] );
        }
    };

    var IndexQuery = function ( table , db , indexName ) {
        var that = this;
        var modifyObj = false;

        var runQuery = function ( type, args , cursorType , direction, limitRange, filters , mapper ) {
            var transaction = db.transaction( table, modifyObj ? transactionModes.readwrite : transactionModes.readonly ),
                store = transaction.objectStore( table ),
                index = indexName ? store.index( indexName ) : store,
                keyRange = type ? IDBKeyRange[ type ].apply( null, args ) : null,
                results = [],
                indexArgs = [ keyRange ],
                limitRange = limitRange ? limitRange : null,
                filters = filters ? filters : [],
                counter = 0;

            if ( cursorType !== 'count' ) {
                indexArgs.push( direction || 'next' );
            };

            // create a function that will set in the modifyObj properties into
            // the passed record.
            var modifyKeys = modifyObj ? Object.keys(modifyObj) : false;
            var modifyRecord = function(record) {
                for(var i = 0; i < modifyKeys.length; i++) {
                    var key = modifyKeys[i];
                    var val = modifyObj[key];
                    if(val instanceof Function) val = val(record);
                    record[key] = val;
                }
                return record;
            };

            index[cursorType].apply( index , indexArgs ).onsuccess = function ( e ) {
                var cursor = e.target.result;
                if ( typeof cursor === typeof 0 ) {
                    results = cursor;
                } else if ( cursor ) {
                	if ( limitRange !== null && limitRange[0] > counter) {
                    	counter = limitRange[0];
                    	cursor.advance(limitRange[0]);
                    } else if ( limitRange !== null && counter >= (limitRange[0] + limitRange[1]) ) {
                        //out of limit range... skip
                    } else {
                        var matchFilter = true;
                        var result = 'value' in cursor ? cursor.value : cursor.key;

                        filters.forEach( function ( filter ) {
                            if ( !filter || !filter.length ) {
                                //Invalid filter do nothing
                            } else if ( filter.length === 2 ) {
                                matchFilter = matchFilter && (result[filter[0]] === filter[1])
                            } else {
                                matchFilter = matchFilter && filter[0].apply(undefined,[result]);
                            }
                        });

                        if (matchFilter) {
                            counter++;
                            results.push( mapper(result) );
                            // if we're doing a modify, run it now
                            if(modifyObj) {
                                result = modifyRecord(result);
                                cursor.update(result);
                            }
                        }
                        cursor['continue']();
                    }
                }
            };

            return new Promise(function(resolve, reject){
              transaction.oncomplete = function () {
                  resolve( results );
              };
              transaction.onerror = function ( e ) {
                  reject( e );
              };
              transaction.onabort = function ( e ) {
                  reject( e );
              };
            });
        };

        var Query = function ( type , args ) {
            var direction = 'next',
                cursorType = 'openCursor',
                filters = [],
                limitRange = null,
                mapper = defaultMapper,
                unique = false;

            var execute = function () {
                return runQuery( type , args , cursorType , unique ? direction + 'unique' : direction, limitRange, filters , mapper );
            };

            var limit = function () {
                limitRange = Array.prototype.slice.call( arguments , 0 , 2 )
                if (limitRange.length == 1) {
                    limitRange.unshift(0)
                }

                return {
                    execute: execute
                };
            };
            var count = function () {
                direction = null;
                cursorType = 'count';

                return {
                    execute: execute
                };
            };
            var keys = function () {
                cursorType = 'openKeyCursor';

                return {
                    desc: desc,
                    execute: execute,
                    filter: filter,
                    distinct: distinct,
                    map: map
                };
            };
            var filter = function ( ) {
                filters.push( Array.prototype.slice.call( arguments , 0 , 2 ) );

                return {
                    keys: keys,
                    execute: execute,
                    filter: filter,
                    desc: desc,
                    distinct: distinct,
                    modify: modify,
                    limit: limit,
                    map: map
                };
            };
            var desc = function () {
                direction = 'prev';

                return {
                    keys: keys,
                    execute: execute,
                    filter: filter,
                    distinct: distinct,
                    modify: modify,
                    map: map
                };
            };
            var distinct = function () {
                unique = true;
                return {
                    keys: keys,
                    count: count,
                    execute: execute,
                    filter: filter,
                    desc: desc,
                    modify: modify,
                    map: map
                };
            };
            var modify = function(update) {
                modifyObj = update;
                return {
                    execute: execute
                };
            };
            var map = function (fn) {
                mapper = fn;

                return {
                    execute: execute,
                    count: count,
                    keys: keys,
                    filter: filter,
                    desc: desc,
                    distinct: distinct,
                    modify: modify,
                    limit: limit,
                    map: map
                };
            };

            return {
                execute: execute,
                count: count,
                keys: keys,
                filter: filter,
                desc: desc,
                distinct: distinct,
                modify: modify,
                limit: limit,
                map: map
            };
        };

        'only bound upperBound lowerBound'.split(' ').forEach(function (name) {
            that[name] = function () {
                return new Query( name , arguments );
            };
        });

        this.filter = function () {
            var query = new Query( null , null );
            return query.filter.apply( query , arguments );
        };

        this.all = function () {
            return this.filter();
        };
    };

    var createSchema = function ( e , schema , db ) {
        if ( typeof schema === 'function' ) {
            schema = schema();
        }

        for ( var tableName in schema ) {
            var table = schema[ tableName ];
            var store;
            if (!hasOwn.call(schema, tableName) || db.objectStoreNames.contains(tableName)) {
                store = e.currentTarget.transaction.objectStore(tableName);
            } else {
                store = db.createObjectStore(tableName, table.key);
            }

            for ( var indexKey in table.indexes ) {
                var index = table.indexes[ indexKey ];
                try {
                    store.index(indexKey)
                } catch (e) {
                    store.createIndex( indexKey , index.key || indexKey , Object.keys(index).length ? index : { unique: false } );
                }
            }
        }
    };

    var open = function ( e , server , version , schema ) {
        var db = e.target.result;
        var s = new Server( db , server );
        var upgrade;

        dbCache[ server ] = db;

        return Promise.resolve(s)
    };

    var dbCache = {};

    var db = {
        version: '0.9.2',
        open: function ( options ) {
            var request;

            return new Promise(function(resolve, reject){
              if ( dbCache[ options.server ] ) {
                  open( {
                      target: {
                          result: dbCache[ options.server ]
                      }
                  } , options.server , options.version , options.schema )
                  .then(resolve, reject)
              } else {
                  request = getIndexedDB().open( options.server , options.version );

                  request.onsuccess = function ( e ) {
                      open( e , options.server , options.version , options.schema )
                          .then(resolve, reject)
                  };

                  request.onupgradeneeded = function ( e ) {
                      createSchema( e , options.schema , e.target.result );
                  };
                  request.onerror = function ( e ) {
                      reject( e );
                  };
              }
            });
        }
    };

    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = db;
    } else if ( typeof define === 'function' && define.amd ) {
        define( function() { return db; } );
    } else {
        window.db = db;
    }
})( window );
