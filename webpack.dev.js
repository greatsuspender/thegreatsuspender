/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = merge(common, {
  watch: true,
  devtool: 'inline-source-map',
  mode: 'development',
  entry: {
    tests: './src/js/tests/tests.js',
  },
  plugins: [
    new webpack.DefinePlugin({
      __WEBPACK_DEBUG_INFO__: true,
      __WEBPACK_DEBUG_ERROR__: true,
    }),
    new CopyWebpackPlugin([
      {
        from: './src/*.js',
        to: '',
        flatten: true,
      },
    ]),
  ],
});
