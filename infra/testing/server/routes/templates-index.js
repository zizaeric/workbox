/*
  Copyright 2019 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

const fs = require('fs-extra');
const templateData = require('../template-data');


// Match any path ending with a trailing slash. In the handler we check
// for the presence of an `index.html.njk` file and serve that if it exists.
const match = /\/$/;

async function handler(req, res, next) {
  const indexTemplate = req.path.slice(1) + 'index.html.njk';

  if (fs.existsSync(indexTemplate)) {
    // Since templates can change between tests without the URL changing,
    // we need to make sure the browser doesn't cache the response.
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Expires', '0');
    res.set('Content-Type', 'text/html');

    res.render(indexTemplate, templateData.get());
  } else {
    next();
  }
}

module.exports = {
  handler,
  match,
};
