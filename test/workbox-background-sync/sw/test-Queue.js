/*
  Copyright 2018 Google LLC

  Use of this source code is governed by an MIT-style
  license that can be found in the LICENSE file or at
  https://opensource.org/licenses/MIT.
*/

describe(`Queue`, function() {
  const {Queue} = workbox.backgroundSync;
  const {DBWrapper} = workbox.core._private;

  const MINUTES = 60 * 1000;
  const sandbox = sinon.createSandbox();

  const createSyncEventStub = (tag) => {
    const event = new SyncEvent('sync', {tag});

    // Default to resolving in the next microtask.
    let done = Promise.resolve();

    // Browsers will throw if code tries to call `waitUntil()` on a user-created
    // sync event, so we have to stub it.
    event.waitUntil = (promise) => {
      // If `waitUntil` is called, defer `done` until after it resolves.
      if (promise) {
        done = promise.then(done);
      }
    };

    return {event, done};
  };

  const getStoredRequests = async () => {
    const db = await new DBWrapper('workbox-background-sync').open();
    return await db.getAll('requests');
  };

  const clearIndexedDBEntries = async () => {
    // Open a conection to the database (at whatever version exists) and
    // clear out all object stores. This strategy is used because deleting
    // databases inside service worker is flaky in FF and Safari.
    const db = await new DBWrapper('workbox-background-sync').open();

    // Edge cannot convert a DOMStringList to an array via `[...list]`.
    for (const store of Array.from(db.db.objectStoreNames)) {
      await db.clear(store);
    }
    await db.close();
  };

  beforeEach(async function() {
    await clearIndexedDBEntries();
    Queue._queueNames.clear();

    // Don't actually register for a sync event in any test, as it could
    // make the tests non-deterministic.
    if ('sync' in registration) {
      sandbox.stub(registration.sync, 'register');
    }

    // This method gets called
    sandbox.stub(Queue.prototype, 'replayRequests');
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe(`constructor`, function() {
    it(`throws if two queues are created with the same name`, async function() {
      expect(() => {
        new Queue('foo');
        new Queue('bar');
      }).not.to.throw();

      try {
        new Queue('foo');

        throw new Error('Expected above to throw');
      } catch (e) {
        // Do nothing
      }

      expect(() => {
        new Queue('baz');
      }).not.to.throw();
    });

    it(`adds a sync event listener (if supported) that runs the onSync function when a sync event is dispatched`, async function() {
      if (!('sync' in registration)) this.skip();

      sandbox.spy(self, 'addEventListener');
      const onSync = sandbox.spy();

      const queue = new Queue('foo', {onSync});

      expect(self.addEventListener.calledOnce).to.be.true;
      expect(self.addEventListener.calledWith('sync')).to.be.true;

      const sync1 = createSyncEventStub('workbox-background-sync:foo');
      self.dispatchEvent(sync1.event);
      await sync1.done;

      // `onSync` should not be called because the tag won't match.
      const sync2 = createSyncEventStub('workbox-background-sync:bar');
      self.dispatchEvent(sync2.event);
      await sync2.done;

      expect(onSync.callCount).to.equal(1);
      expect(onSync.firstCall.args[0].queue).to.equal(queue);
    });

    it(`defaults to calling replayRequests (if supported) when no onSync function is passed`, async function() {
      if (!('sync' in registration)) this.skip();

      sandbox.spy(self, 'addEventListener');

      const queue = new Queue('foo');

      expect(self.addEventListener.calledOnce).to.be.true;
      expect(self.addEventListener.calledWith('sync')).to.be.true;

      const sync1 = createSyncEventStub('workbox-background-sync:foo');
      self.dispatchEvent(sync1.event);
      await sync1.done;

      // `replayRequests` should not be called because the tag won't match.
      const sync2 = createSyncEventStub('workbox-background-sync:bar');
      self.dispatchEvent(sync2.event);
      await sync2.done;

      // `replayRequsets` is stubbed in beforeEach, so we don't have to
      // re-stub in this test, and we can just assert it was called.
      expect(Queue.prototype.replayRequests.callCount).to.equal(1);
      expect(Queue.prototype.replayRequests.firstCall.args[0].queue)
          .to.equal(queue);
    });

    it(`tries to run the sync logic on instantiation iff the browser doesn't support Background Sync`, async function() {
      const onSync = sandbox.spy();
      new Queue('foo', {onSync});

      if ('sync' in registration) {
        expect(onSync.calledOnce).to.be.false;
      } else {
        expect(onSync.calledOnce).to.be.true;
      }
    });
  });

  describe(`pushRequest`, function() {
    it(`should add a request to the IndexedDB store`, async function() {
      const queueA = new Queue('a');
      const queueB = new Queue('b');

      await queueA.pushRequest({
        request: new Request('/one'),
        timestamp: 123,
        metadata: {meta1: 'data1'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(1);

      await queueA.pushRequest({
        request: new Request('/two'),
        timestamp: 234,
        metadata: {meta2: 'data2'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(2);

      await queueB.pushRequest({
        request: new Request('/three'),
        timestamp: 345,
        metadata: {meta3: 'data3'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(3);

      await queueA.pushRequest({
        request: new Request('/four'),
        timestamp: 456,
        metadata: {meta4: 'data4'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(4);

      await queueB.pushRequest({
        request: new Request('/five'),
        timestamp: 567,
        metadata: {meta5: 'data5'},
      });

      const entries = await getStoredRequests();

      expect(entries).to.have.lengthOf(5);

      // Assert the requests were added in the correct order.
      expect(entries[0].requestData.url).to.equal(`${location.origin}/one`);
      expect(entries[0].queueName).to.equal('a');
      expect(entries[1].requestData.url).to.equal(`${location.origin}/two`);
      expect(entries[1].queueName).to.equal('a');
      expect(entries[2].requestData.url).to.equal(`${location.origin}/three`);
      expect(entries[2].queueName).to.equal('b');
      expect(entries[3].requestData.url).to.equal(`${location.origin}/four`);
      expect(entries[3].queueName).to.equal('a');
      expect(entries[4].requestData.url).to.equal(`${location.origin}/five`);
      expect(entries[4].queueName).to.equal('b');
    });

    it(`should not require metadata`, async function() {
      const queue = new Queue('a');
      const request = new Request('/');

      await queue.pushRequest({request: request});

      const entries = await getStoredRequests();
      expect(entries).to.have.lengthOf(1);
      expect(entries[0].metadata).to.be.undefined;
    });

    it(`should use the current time as the timestamp when not specified`, async function() {
      sandbox.useFakeTimers({
        toFake: ['Date'],
        now: 1234,
      });

      const queue = new Queue('a');
      const request = new Request('/');

      await queue.pushRequest({request});

      const entries = await getStoredRequests();
      expect(entries).to.have.lengthOf(1);
      expect(entries[0].timestamp).to.equal(1234);
    });

    it(`should register to receive sync events for a unique tag`, async function() {
      if (!('sync' in registration)) this.skip();

      const queue = new Queue('foo');

      await queue.pushRequest({request: new Request('/')});

      // self.registration.sync.register is stubbed in `beforeEach()`.
      expect(self.registration.sync.register.calledOnce).to.be.true;
      expect(self.registration.sync.register.calledWith(
          'workbox-background-sync:foo')).to.be.true;
    });
  });

  describe(`unshiftRequest`, function() {
    it(`should add a request to the beginning of the IndexedDB store`, async function() {
      const queueA = new Queue('a');
      const queueB = new Queue('b');

      await queueA.unshiftRequest({
        request: new Request('/one'),
        timestamp: 123,
        metadata: {meta1: 'data1'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(1);

      await queueA.unshiftRequest({
        request: new Request('/two'),
        timestamp: 234,
        metadata: {meta2: 'data2'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(2);

      await queueB.unshiftRequest({
        request: new Request('/three'),
        timestamp: 345,
        metadata: {meta3: 'data3'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(3);

      await queueA.unshiftRequest({
        request: new Request('/four'),
        timestamp: 456,
        metadata: {meta4: 'data4'},
      });

      expect(await getStoredRequests()).to.have.lengthOf(4);

      await queueB.unshiftRequest({
        request: new Request('/five'),
        timestamp: 567,
        metadata: {meta5: 'data5'},
      });

      const entries = await getStoredRequests();

      expect(entries).to.have.lengthOf(5);

      // Assert the requests were added in the correct order.
      expect(entries[0].requestData.url).to.equal(`${location.origin}/five`);
      expect(entries[0].queueName).to.equal('b');
      expect(entries[1].requestData.url).to.equal(`${location.origin}/four`);
      expect(entries[1].queueName).to.equal('a');
      expect(entries[2].requestData.url).to.equal(`${location.origin}/three`);
      expect(entries[2].queueName).to.equal('b');
      expect(entries[3].requestData.url).to.equal(`${location.origin}/two`);
      expect(entries[3].queueName).to.equal('a');
      expect(entries[4].requestData.url).to.equal(`${location.origin}/one`);
      expect(entries[4].queueName).to.equal('a');
    });

    it(`should not require metadata`, async function() {
      const queue = new Queue('a');
      const request = new Request('/');

      await queue.unshiftRequest({request: request});

      const entries = await getStoredRequests();
      expect(entries).to.have.lengthOf(1);
      expect(entries[0].metadata).to.be.undefined;
    });

    it(`should use the current time as the timestamp when not specified`, async function() {
      sandbox.useFakeTimers({
        toFake: ['Date'],
        now: 1234,
      });

      const queue = new Queue('a');
      const request = new Request('/');

      await queue.unshiftRequest({request});

      const entries = await getStoredRequests();
      expect(entries).to.have.lengthOf(1);
      expect(entries[0].timestamp).to.equal(1234);
    });

    it(`should register to receive sync events for a unique tag`, async function() {
      if (!('sync' in registration)) this.skip();

      const queue = new Queue('foo');

      await queue.unshiftRequest({request: new Request('/')});

      // self.registration.sync.register is stubbed in `beforeEach()`.
      expect(self.registration.sync.register.calledOnce).to.be.true;
      expect(self.registration.sync.register.calledWith(
          'workbox-background-sync:foo')).to.be.true;
    });
  });

  describe(`shiftRequest`, function() {
    it(`gets and removes the first request in the QueueStore instance`, async function() {
      const queueA = new Queue('a');
      const queueB = new Queue('b');

      await queueA.pushRequest({request: new Request('/one')});

      // Add this request a amid other requests and queues to ensure the
      // correct one is returned.
      await queueB.pushRequest({
        request: new Request('/two', {
          method: 'POST',
          body: 'testing...',
          headers: {'x-foo': 'bar'},
        }),
      });

      await queueA.pushRequest({request: new Request('/three')});
      await queueB.pushRequest({request: new Request('/four')});

      expect(await getStoredRequests()).to.have.lengthOf(4);

      const entry1 = await queueB.shiftRequest();
      expect(entry1.request.url).to.equal(`${location.origin}/two`);
      expect(entry1.request.method).to.equal('POST');
      expect(await entry1.request.text()).to.equal('testing...');
      expect(entry1.request.headers.get('x-foo')).to.equal('bar');

      // Test that the entry was removed from IDB.
      expect(await getStoredRequests()).to.have.lengthOf(3);

      const entry2 = await queueB.shiftRequest();
      expect(entry2.request.url).to.equal(`${location.origin}/four`);
    });

    it(`returns the timestamp and any passed metadata along with the request`, async function() {
      const queue = new Queue('a');

      await queue.pushRequest({
        metadata: {meta1: 'data1'},
        request: new Request('/one'),
      });

      await queue.pushRequest({
        metadata: {meta2: 'data2'},
        request: new Request('/two'),
      });

      const entry1 = await queue.shiftRequest();
      const entry2 = await queue.shiftRequest();

      expect(entry1.request.url).to.equal(`${location.origin}/one`);
      expect(entry1.metadata).to.deep.equal({meta1: 'data1'});

      expect(entry2.request.url).to.equal(`${location.origin}/two`);
      expect(entry2.metadata).to.deep.equal({meta2: 'data2'});
    });

    it(`does not return requests that have expired`, async function() {
      const DAYS = 1000 * 60 * 60 * 24;
      const queue = new Queue('a');

      await queue.pushRequest({
        request: new Request('/one'),
        timestamp: Date.now() - (10 * DAYS),
      });
      await queue.pushRequest({
        request: new Request('/two'),
      });
      await queue.pushRequest({
        request: new Request('/three'),
        timestamp: Date.now() - (100 * DAYS),
      });
      await queue.pushRequest({
        request: new Request('/four'),
        timestamp: Date.now() - (2 * DAYS),
      });

      const entry1 = await queue.shiftRequest();
      const entry2 = await queue.shiftRequest();
      const entry3 = await queue.shiftRequest();

      expect(entry1.request.url).to.equal(`${location.origin}/two`);
      expect(entry2.request.url).to.equal(`${location.origin}/four`);
      expect(entry3).to.be.undefined;
    });
  });

  describe(`popRequest`, function() {
    it(`gets and removes the last request in the QueueStore instance`, async function() {
      const queueA = new Queue('a');
      const queueB = new Queue('b');

      await queueA.pushRequest({request: new Request('/one')});

      // Add this request a amid other requests and queues to ensure the
      // correct one is returned.
      await queueB.pushRequest({
        request: new Request('/two', {
          method: 'POST',
          body: 'testing...',
          headers: {'x-foo': 'bar'},
        }),
      });

      await queueA.pushRequest({request: new Request('/three')});
      await queueB.pushRequest({request: new Request('/four')});

      expect(await getStoredRequests()).to.have.lengthOf(4);

      const entry1 = await queueB.popRequest();
      expect(entry1.request.url).to.equal(`${location.origin}/four`);

      // Test that the entry was removed from IDB.
      expect(await getStoredRequests()).to.have.lengthOf(3);

      const entry2 = await queueB.popRequest();
      expect(entry2.request.url).to.equal(`${location.origin}/two`);
      expect(entry2.request.method).to.equal('POST');
      expect(await entry2.request.text()).to.equal('testing...');
      expect(entry2.request.headers.get('x-foo')).to.equal('bar');
    });

    it(`returns the timestamp and any passed metadata along with the request`, async function() {
      const queue = new Queue('a');

      await queue.pushRequest({
        metadata: {meta1: 'data1'},
        request: new Request('/one'),
      });

      await queue.pushRequest({
        metadata: {meta2: 'data2'},
        request: new Request('/two'),
      });

      const entry1 = await queue.popRequest();
      const entry2 = await queue.popRequest();

      expect(entry1.request.url).to.equal(`${location.origin}/two`);
      expect(entry1.metadata).to.deep.equal({meta2: 'data2'});

      expect(entry2.request.url).to.equal(`${location.origin}/one`);
      expect(entry2.metadata).to.deep.equal({meta1: 'data1'});
    });

    it(`does not return requests that have expired`, async function() {
      const DAYS = 1000 * 60 * 60 * 24;
      const queue = new Queue('a');

      await queue.pushRequest({
        request: new Request('/one'),
        timestamp: Date.now() - (10 * DAYS),
      });
      await queue.pushRequest({
        request: new Request('/two'),
      });
      await queue.pushRequest({
        request: new Request('/three'),
        timestamp: Date.now() - (100 * DAYS),
      });
      await queue.pushRequest({
        request: new Request('/four'),
        timestamp: Date.now() - (2 * DAYS),
      });

      const entry1 = await queue.popRequest();
      const entry2 = await queue.popRequest();
      const entry3 = await queue.popRequest();

      expect(entry1.request.url).to.equal(`${location.origin}/four`);
      expect(entry2.request.url).to.equal(`${location.origin}/two`);
      expect(entry3).to.be.undefined;
    });
  });

  describe(`replayRequests`, function() {
    beforeEach(function() {
      // Unstub replayRequests for all tests in this group.
      Queue.prototype.replayRequests.restore();
    });

    it(`should try to re-fetch all requests in the queue`, async function() {
      sandbox.stub(self, 'fetch');

      const queueA = new Queue('a');
      const queueB = new Queue('b');

      // Add requests for both queues to ensure only the requests from
      // the matching queue are replayed.
      await queueA.pushRequest({request: new Request('/one')});
      await queueB.pushRequest({request: new Request('/two')});
      await queueA.pushRequest({request: new Request('/three')});
      await queueB.pushRequest({request: new Request('/four')});
      await queueA.pushRequest({request: new Request('/five')});

      await queueA.replayRequests();

      expect(self.fetch.callCount).to.equal(3);
      expect(self.fetch.args[0][0].url).to.equal(`${location.origin}/one`);
      expect(self.fetch.args[1][0].url).to.equal(`${location.origin}/three`);
      expect(self.fetch.args[2][0].url).to.equal(`${location.origin}/five`);

      await queueB.replayRequests();

      expect(self.fetch.callCount).to.equal(5);
      expect(self.fetch.args[3][0].url).to.equal(`${location.origin}/two`);
      expect(self.fetch.args[4][0].url).to.equal(`${location.origin}/four`);
    });

    it(`should remove requests after a successful retry`, async function() {
      sandbox.stub(self, 'fetch');

      const queueA = new Queue('a');
      const queueB = new Queue('b');

      // Add requests for both queues to ensure only the requests from
      // the matching queue are replayed.
      await queueA.pushRequest({request: new Request('/one')});
      await queueB.pushRequest({request: new Request('/two')});
      await queueA.pushRequest({request: new Request('/three')});
      await queueB.pushRequest({request: new Request('/four')});
      await queueA.pushRequest({request: new Request('/five')});

      await queueA.replayRequests();
      expect(self.fetch.callCount).to.equal(3);

      const entries = await getStoredRequests();
      expect(entries.length).to.equal(2);
      expect(entries[0].requestData.url).to.equal(`${location.origin}/two`);
      expect(entries[1].requestData.url).to.equal(`${location.origin}/four`);
    });

    it(`should ignore (and remove) requests if maxRetentionTime has passed`, async function() {
      sandbox.stub(self, 'fetch');
      const clock = sandbox.useFakeTimers({
        now: Date.now(),
        toFake: ['Date'],
      });

      const queue = new Queue('foo', {
        maxRetentionTime: 1,
      });

      await queue.pushRequest({request: new Request('/one')});
      await queue.pushRequest({request: new Request('/two')});

      clock.tick(1 * MINUTES + 1); // One minute and 1ms.

      await queue.pushRequest({request: new Request('/three')});
      await queue.replayRequests();

      expect(self.fetch.calledOnce).to.be.true;
      expect(self.fetch.calledWith(sinon.match({
        url: `${location.origin}/three`,
      }))).to.be.true;

      const entries = await getStoredRequests();
      // Assert that the two requests not replayed were deleted.
      expect(entries.length).to.equal(0);
    });

    it(`should stop replaying if a request fails`, async function() {
      sandbox.stub(self, 'fetch')
          .onCall(3).rejects(new Error());

      const queue = new Queue('a');

      await queue.pushRequest({request: new Request('/one')});
      await queue.pushRequest({request: new Request('/two')});
      await queue.pushRequest({request: new Request('/three')});
      await queue.pushRequest({request: new Request('/four')});
      await queue.pushRequest({request: new Request('/five')});

      await expectError(() => {
        return queue.replayRequests(); // The 4th requests should fail.
      }, 'queue-replay-failed');

      const entries = await getStoredRequests();
      expect(entries.length).to.equal(2);
      expect(entries[0].requestData.url).to.equal(`${location.origin}/four`);
      expect(entries[1].requestData.url).to.equal(`${location.origin}/five`);
    });

    it(`should throw WorkboxError if re-fetching fails`, async function() {
      sandbox.stub(self, 'fetch')
          .onCall(1).rejects(new Error());

      const failureURL = '/two';
      const queue = new Queue('a');

      // Add requests for both queues to ensure only the requests from
      // the matching queue are replayed.
      await queue.pushRequest({request: new Request('/one')});
      await queue.pushRequest({request: new Request(failureURL)});

      await expectError(() => {
        return queue.replayRequests();
      }, 'queue-replay-failed');
    });
  });

  describe(`registerSync()`, function() {
    it(`should succeed regardless of browser support for sync`, async function() {
      const queue = new Queue('a');
      await queue.registerSync();
    });

    it(`should handle thrown errors in sync registration`, async function() {
      if (!('sync' in registration)) this.skip();

      registration.sync.register.restore();

      sandbox.stub(registration.sync, 'register').callsFake(() => {
        return Promise.reject(new Error('Injected Error'));
      });

      const queue = new Queue('a');
      await queue.registerSync();
    });
  });
});
