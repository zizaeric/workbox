/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

const {ConcatSource} = require('webpack-sources');
const {generateSWString} = require('workbox-build');
const {promisify} = require('util');
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

    parentCompiler.hooks.make.tapAsync(pluginName, async (compilation, cb) => {
      const outputOptions = {
        path: parentCompiler.options.output.path,
        filename: this.config.swDest,
      };

      const childCompiler = compilation.createChildCompiler(
          pluginName, outputOptions);

      childCompiler.context = parentCompiler.context;
      childCompiler.inputFileSystem = parentCompiler.inputFileSystem;
      childCompiler.outputFileSystem = parentCompiler.outputFileSystem;

      childCompiler.resolverFactory.hooks.resolveOptions.tap(
          'normal', pluginName, (options) => {
            options.modules = [
              path.resolve(__dirname, '..', 'node_modules', 'workbox-build',
                  'node_modules'),
              'node_modules',
            ];
          }
      );

      const {swString, warnings} = await generateSWString(
          sanitizeConfig.forGenerateSWString(this.config));

      const mkdirp = promisify(childCompiler.outputFileSystem.mkdirp);
      const writeFile = promisify(childCompiler.outputFileSystem.writeFile);

      const fullPath = childCompiler.outputFileSystem.join(outputOptions.path,
          outputOptions.filename);
      await mkdirp(outputOptions.path);
      await writeFile(fullPath, swString);

      new SingleEntryPlugin(
          outputOptions.path,
          './' + outputOptions.filename,
          'Workbox service worker',
      ).apply(childCompiler);

      childCompiler.runAsChild((error, entries, childCompilation) => {
        if (error) {
          return cb(error);
        }

        compilation.warnings = compilation.warnings.concat(
            childCompilation.warnings).concat(warnings);
        compilation.errors = compilation.errors.concat(
            childCompilation.errors);

        cb();
      });
    });

    parentCompiler.hooks.emit.tapAsync(pluginName, (compilation, cb) => {
      const swAsset = compilation.assets[this.config.swDest];
      delete compilation.assets[this.config.swDest];

      const manifestEntries = getManifestEntriesFromCompilation(
          compilation, this.config);

      compilation.assets[this.config.swDest] = new ConcatSource(
          stringifyManifest(manifestEntries), swAsset);

      cb();
    });
  }
}

module.exports = GenerateSW;
