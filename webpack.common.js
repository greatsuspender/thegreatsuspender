/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './src/js/background.js',
    contentScript: './src/js/contentscript.js',
    popup: './src/js/popup.js',
    about: './src/js/about.js',
    debug: './src/js/debug.js',
    history: './src/js/history.js',
    notice: './src/js/notice.js',
    options: './src/js/options.js',
    permissions: './src/js/permissions.js',
    recovery: './src/js/recovery.js',
    'restoring-window': './src/js/restoring-window.js',
    shortcuts: './src/js/shortcuts.js',
    thanks: './src/js/thanks.js',
    update: './src/js/update.js',
    updated: './src/js/updated.js',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  plugins: [
    new CopyWebpackPlugin([
      {
        from: './src/manifest.json',
        to: 'manifest.json',
      },
      {
        from: './src/*.html',
        to: '',
        flatten: true,
      },
      {
        from: './src/css/*.css',
        to: 'css',
        flatten: true,
      },
      {
        from: './src/font/*',
        to: 'font',
        flatten: true,
      },
      {
        from: './src/img/*',
        to: 'img',
        flatten: true,
      },
      {
        from: './src/_locales',
        to: '_locales',
      },
    ]),
  ],
};
