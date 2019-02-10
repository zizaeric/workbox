/*
  Copyright 2019 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

const templateData = require('../template-data');


// Matches any URL ending in `.njk` and renders the file at the full path
// as a nunjucks template.
const match = /(\.[a-z]+)\.njk$/;

async function handler(req, res) {
  const ext = req.params[0];

  // Since templates can change between tests without the URL changing,
  // we need to make sure the browser doesn't cache the response.
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Expires', '0');

  switch (ext) {
    case '.js':
    case '.mjs':
      res.set('Content-Type', 'text/javascript');
      break;
    case '.html':
      res.set('Content-Type', 'text/html');
      break;
  }

  res.render(req.path.slice(1), templateData.get());
}

module.exports = {
  handler,
  match,
};
