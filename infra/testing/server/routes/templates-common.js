/*
  Copyright 2019 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

const path = require('path');
const templateData = require('../template-data');


// Matches any URL ending in `common.njk` and renders the file in the
// `../templates/*` directory as the response.
// NOTE: this allow you to serve a template file with any directory path,
// which is useful when dealing with service worker scope.
const match = /(\.[a-z]+)\.common.njk$/;

async function handler(req, res) {
  const ext = req.params[0];

  switch (ext) {
    case '.js':
    case '.mjs':
      res.set('Content-Type', 'text/javascript');
      break;
    case '.html':
      res.set('Content-Type', 'text/html');
      break;
  }

  const basename = path.basename(req.path).replace('.common', '');
  const file = path.join(__dirname, '..', 'templates', basename);
  res.render(file, templateData.get());
}

module.exports = {
  handler,
  match,
};
