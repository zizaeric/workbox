/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

importScripts('/__WORKBOX/buildFile/workbox-sw');
workbox.setConfig({modulePathPrefix: '/__WORKBOX/buildFile/'});


const queue = new workbox.backgroundSync.Queue('myQueueName');

addEventListener('fetch', (event) => {
  const pathname = new URL(event.request.url).pathname;
  if (pathname === '/test/workbox-background-sync/static/basic-example/example.txt') {
    const queuePromise = (async () => {
      await queue.pushRequest({request: event.request});
      // This is a horrible hack :(
      // In non-sync supporting browsers we only replay requests when the SW starts up
      // but there is no API to force close a service worker, so just force a replay in
      // this situation to "fake" a sw starting up......
      if (!('sync' in registration)) {
        await queue.replayRequests();
      }
    })();

    event.respondWith(Promise.resolve(new Response(`Added to BG Sync`)));
    event.waitUntil(queuePromise);
  }
});

addEventListener('install', (event) => event.waitUntil(skipWaiting()));
addEventListener('activate', (event) => event.waitUntil(clients.claim()));
