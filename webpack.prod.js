/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'production',
  plugins: [
    new webpack.DefinePlugin({
      __WEBPACK_DEBUG_INFO__: false,
      __WEBPACK_DEBUG_ERROR__: false,
    }),
  ],
});
