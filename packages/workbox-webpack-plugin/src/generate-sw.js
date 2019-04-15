/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

const {generateSWString} = require('workbox-build');
const {ConcatSource} = require('webpack-sources');
const path = require('path');
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');

const convertStringToAsset = require('./lib/convert-string-to-asset');
const getDefaultConfig = require('./lib/get-default-config');
const formatManifestFilename = require('./lib/format-manifest-filename');
const getAssetHash = require('./lib/get-asset-hash');
const getManifestEntriesFromCompilation =
  require('./lib/get-manifest-entries-from-compilation');
const getWorkboxSWImports = require('./lib/get-workbox-sw-imports');
const relativeToOutputPath = require('./lib/relative-to-output-path');
const sanitizeConfig = require('./lib/sanitize-config');
const stringifyManifest = require('./lib/stringify-manifest');
const warnAboutConfig = require('./lib/warn-about-config');

/**
 * This class supports creating a new, ready-to-use service worker file as
 * part of the webpack compilation process.
 *
 * Use an instance of `GenerateSW` in the
 * [`plugins` array](https://webpack.js.org/concepts/plugins/#usage) of a
 * webpack config.
 *
 * @module workbox-webpack-plugin
 */
class GenerateSW {
  /**
   * Creates an instance of GenerateSW.
   *
   * @param {Object} [config] See the
   * [configuration guide](https://developers.google.com/web/tools/workbox/modules/workbox-webpack-plugin#configuration)
   * for all supported options and defaults.
   */
  constructor(config = {}) {
    this.config = Object.assign(getDefaultConfig(), {
      // Hardcode this default filename, since we don't have swSrc to read from
      // (like we do in InjectManifest).
      swDest: 'service-worker.js',
    }, config);
  }

  /**
   * @param {Object} [parentCompiler] default compiler object passed from webpack
   *
   * @private
   */
  apply(parentCompiler) {
    const pluginName = this.constructor.name;

    parentCompiler.hooks.make.tapAsync(pluginName, (compilation, callback) => {
      const outputOptions = {
        path: parentCompiler.options.output.path,
        filename: this.config.swDest,
      };

      const childCompiler = compilation.createChildCompiler(
          pluginName, outputOptions);
      childCompiler.context = parentCompiler.context;
      childCompiler.inputFileSystem = parentCompiler.inputFileSystem;

      new SingleEntryPlugin(
          parentCompiler.context,
          path.resolve(__dirname, 'sw-template.js'),
          'Workbox service worker',
      ).apply(childCompiler);

      childCompiler.runAsChild((error, entries, childCompilation) => {
        callback(error);
      });
    });

    parentCompiler.hooks.emit.tapAsync(pluginName, (compilation, callback) => {
      const swAsset = compilation.assets[this.config.swDest];
      delete compilation.assets[this.config.swDest];

      const manifestEntries = getManifestEntriesFromCompilation(
          compilation, this.config);

      compilation.assets[this.config.swDest] = new ConcatSource(
          stringifyManifest(manifestEntries), swAsset);

      callback();
    });
  }
}

module.exports = GenerateSW;
