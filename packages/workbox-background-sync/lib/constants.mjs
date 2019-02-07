/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

import '../_version.mjs';


const DB_VERSION = 2;
const DB_NAME = 'workbox-background-sync';
const OBJECT_STORE_NAME = 'requests';
const INDEXED_PROP = 'queueName';
const TAG_PREFIX = 'workbox-background-sync';
const MAX_RETENTION_TIME = 60 * 24 * 7; // 7 days in minutes

export {
  DB_VERSION,
  DB_NAME,
  OBJECT_STORE_NAME,
  INDEXED_PROP,
  TAG_PREFIX,
  MAX_RETENTION_TIME,
};
