/* eslint-env jest */

import type { FetchConnectionMetadataResult } from '../types';
import { Client, FetchConnectionMetadataError } from '..';
import { getWebSocketClass } from '../util/helpers';

// eslint-disable-next-line
const genConnectionMetadata = require('../../debug/genConnectionMetadata');

// eslint-disable-next-line
const WebSocket = require('ws');

jest.setTimeout(30 * 1000);

test('client connect', (done) => {
  const client = new Client<{ username: string }>();

  const ctx = { username: 'zyzz' };

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: ctx,
    },
    ({ channel, error, context }) => {
      expect(channel?.status).toBe('open');
      expect(context).toBe(ctx);
      expect(error).toEqual(null);

      client.close();

      return () => {
        done();
      };
    },
  );
});

test('client connect with connection metadata retry', (done) => {
  const client = new Client<{ username: string }>();

  const ctx = { username: 'zyzz' };

  let tryCount = 0;

  client.open(
    {
      fetchConnectionMetadata: () => {
        tryCount += 1;

        if (tryCount === 1) {
          return Promise.resolve({
            error: FetchConnectionMetadataError.Retriable,
          });
        }

        return Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        });
      },
      WebSocketClass: WebSocket,
      context: ctx,
    },
    ({ channel, error, context }) => {
      expect(tryCount).toBe(2);
      expect(channel?.status).toBe('open');
      expect(context).toBe(ctx);
      expect(error).toEqual(null);

      client.close();

      return () => {
        done();
      };
    },
  );
});

test('client retries', (done) => {
  const client = new Client();

  let tryCount = 0;

  client.open(
    {
      fetchConnectionMetadata: () => {
        tryCount += 1;

        if (tryCount === 1) {
          return Promise.resolve({
            ...genConnectionMetadata(),
            error: null,
            token: 'test - bad connection metadata retries',
          });
        }

        return Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        });
      },
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(tryCount).toBe(2);
      expect(channel?.status).toBe('open');
      expect(error).toEqual(null);

      client.close();

      return () => {
        done();
      };
    },
  );
});

test('client retries and caches tokens', (done) => {
  const client = new Client();

  const fetchConnectionMetadata = jest.fn();

  let reconnectCount = 0;
  client.setDebugFunc((log) => {
    if (log.type !== 'breadcrumb' || log.message !== 'retrying') {
      return;
    }
    reconnectCount += 1;
    if (reconnectCount >= 2) {
      setTimeout(() => {
        client.close();
      });
    }
  });

  client.open(
    {
      timeout: 1,
      fetchConnectionMetadata: () => {
        fetchConnectionMetadata();
        return Promise.resolve({
          token: 'test - bad connection metadata retries',
          gurl: 'ws://invalid.example.com',
          conmanURL: 'http://invalid.example.com',
          error: null,
        });
      },
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ error }) => {
      expect(fetchConnectionMetadata).toHaveBeenCalledTimes(1);

      expect(error).toBeTruthy();
      expect(error?.message).toBe('Failed to open');

      // the client will not ever successfully connect, so this cannot be
      // called in the callback.
      done();

      return () => {};
    },
  );
});

test('channel closing itself when client willReconnect', (done) => {
  let disconnectTriggered = false;
  let clientOpenCount = 0;
  let channelOpenCount = 0;

  const client = new Client();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      clientOpenCount += 1;
      expect(error).toEqual(null);
      expect(channel?.status).toBe('open');

      if (!disconnectTriggered) {
        setTimeout(() => {
          disconnectTriggered = true;
          // eslint-disable-next-line
          // @ts-ignore: trigger unintentional disconnect
          client.ws.close();
        }, 1000);
      } else {
        client.close();
      }

      return ({ willReconnect }) => {
        if (willReconnect) {
          return;
        }

        expect(clientOpenCount).toEqual(2);
        expect(channelOpenCount).toEqual(1);

        done();
      };
    },
  );

  const close = client.openChannel({ service: 'shell' }, ({ channel, error }) => {
    channelOpenCount += 1;
    expect(error).toBe(null);
    expect(channel?.status).toBe('open');

    return ({ willReconnect }) => {
      expect(willReconnect).toBeTruthy();
      // This cleanup function gets called because we triggered an unintentional
      // disconnect above (`client.ws.onclose()`). Since this is unintentional
      // the client will reconnect itself. But this outer `openChannel`callback will NOT
      // get called a second time when the cleint re-connects since we are deliberately
      // closing it on the next line.
      close();
    };
  });
});

test('channel open and close', (done) => {
  const client = new Client();

  const channelClose = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(error).toEqual(null);
      expect(channel?.status).toBe('open');

      return () => {
        expect(channelClose).toHaveBeenCalled();

        done();
      };
    },
  );

  const close = client.openChannel({ service: 'shell' }, ({ channel, error }) => {
    expect(channel?.status).toBe('open');
    expect(error).toBe(null);

    setTimeout(() => {
      close();
      expect(channel?.status).toBe('closing');
    });

    return ({ willReconnect }) => {
      expect(willReconnect).toBeFalsy();
      expect(channel?.status).toBe('closed');

      channelClose();
      client.close();
    };
  });
});

test('channel accepts a thunk for service', (done) => {
  const context = { username: 'aghanim' };
  const client = new Client<typeof context>();

  const channelClose = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context,
    },
    ({ channel, error }) => {
      expect(error).toEqual(null);
      expect(channel?.status).toBe('open');

      return () => {
        expect(channelClose).toHaveBeenCalled();

        done();
      };
    },
  );

  const close = client.openChannel(
    {
      service: (ctx) => {
        expect(ctx.username).toEqual('aghanim');

        return 'exec';
      },
    },
    ({ channel, error }) => {
      expect(channel?.status).toBe('open');
      expect(error).toBe(null);

      setTimeout(() => {
        close();
        expect(channel?.status).toBe('closing');
      });

      return ({ willReconnect }) => {
        expect(willReconnect).toBeFalsy();
        expect(channel?.status).toBe('closed');

        channelClose();
        client.close();
      };
    },
  );
});

test('channel open and close from within openChannelCb synchronously', (done) => {
  const client = new Client();

  const channelClose = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(error).toEqual(null);
      expect(channel?.status).toBe('open');

      return () => {
        expect(channelClose).toHaveBeenCalled();

        done();
      };
    },
  );

  const close = client.openChannel({ service: 'shell' }, ({ channel, error }) => {
    expect(channel?.status).toBe('open');
    expect(error).toBe(null);

    close();

    expect(channel?.status).toBe('closing');

    return ({ willReconnect }) => {
      expect(willReconnect).toBeFalsy();
      expect(channel?.status).toBe('closed');

      channelClose();
      client.close();
    };
  });
});

test('channel open and close from within openChannelCb synchronously', (done) => {
  const client = new Client();

  const channelClose = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(error).toEqual(null);
      expect(channel?.status).toBe('open');

      return () => {
        expect(channelClose).toHaveBeenCalled();

        done();
      };
    },
  );

  const close = client.openChannel({ service: 'shell' }, ({ channel, error }) => {
    expect(channel?.status).toBe('open');
    expect(error).toBe(null);

    close();

    expect(channel?.status).toBe('closing');

    return ({ willReconnect }) => {
      expect(willReconnect).toBeFalsy();
      expect(channel?.status).toBe('closed');

      channelClose();
      client.close();
    };
  });
});

test('channel skips opening', (done) => {
  const client = new Client<{ username: string }>();

  const service = 'shell';
  const ctx = { username: 'midas' };
  const skipfn = jest.fn().mockImplementation(() => true);
  const opencb = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: ctx,
    },
    ({ error }) => {
      expect(error).toBeNull();

      setTimeout(() => {
        expect(skipfn).toHaveBeenCalledTimes(1);
        expect(skipfn).toHaveBeenCalledWith(ctx);
        expect(opencb).not.toHaveBeenCalled();

        client.close();
      }, 0);

      return () => {
        done();
      };
    },
  );

  client.openChannel(
    {
      service,
      skip: skipfn,
    },
    opencb,
  );
});

test('channel skips opening conditionally', (done) => {
  let unexpectedDisconnectTriggered = false;
  let clientOpenCount = 0;
  let channelOpenCount = 0;

  const client = new Client();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      clientOpenCount += 1;
      expect(channel?.status).toBe('open');
      expect(error).toEqual(null);
      if (unexpectedDisconnectTriggered) {
        client.close();
      }

      return ({ willReconnect }) => {
        if (willReconnect) {
          return;
        }

        expect(clientOpenCount).toEqual(2);
        expect(channelOpenCount).toEqual(1);

        done();
      };
    },
  );

  client.openChannel(
    {
      skip: () => channelOpenCount > 0,
      service: 'shell',
    },
    ({ channel, error }) => {
      if (!unexpectedDisconnectTriggered) {
        setTimeout(() => {
          // eslint-disable-next-line
          // @ts-ignore: trigger unintentional disconnect
          client.ws.close();
          unexpectedDisconnectTriggered = true;
        });

        expect(error).toBe(null);
        expect(channel?.status).toBe('open');

        channelOpenCount += 1;

        return;
      }

      expect(error).toBeTruthy();
      expect(error?.message).toBe('Failed to open');
    },
  );
});

test('openChannel before open', (done) => {
  const client = new Client();

  client.openChannel({ service: 'exec' }, ({ channel }) => {
    expect(channel).toBeTruthy();

    client.close();
  });

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel }) => {
      expect(channel).toBeTruthy();

      return () => {
        done();
      };
    },
  );
});

test('closing maintains openChannel requests', (done) => {
  const client = new Client();

  let first = true;
  client.openChannel({ service: 'exec' }, ({ channel }) => {
    expect(channel).toBeTruthy();

    if (first) {
      client.close();
      first = false;

      setTimeout(() => {
        // open again should call this same function
        client.open(
          {
            fetchConnectionMetadata: () =>
              Promise.resolve({
                ...genConnectionMetadata(),
                error: null,
              }),
            WebSocketClass: WebSocket,
            context: null,
          },
          () => {},
        );
      }, 200);
    } else {
      client.close();
    }
  });

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel }) => {
      expect(channel).toBeTruthy();

      return () => {
        done();
      };
    },
  );
});

test('client rejects opening same channel twice', () => {
  const client = new Client();
  client.setUnrecoverableErrorHandler(() => {});

  const name = Math.random().toString();
  client.openChannel({ name, service: 'exec' }, () => {});

  expect(() => {
    client.openChannel({ name, service: 'exec' }, () => {});
  }).toThrow();
});

test('allows opening channel with the same name while if others are closing', (done) => {
  const client = new Client();

  const name = Math.random().toString();

  const close = client.openChannel({ name, service: 'exec' }, () => {
    setTimeout(() => {
      close();
      // open same name synchronously
      client.openChannel({ name, service: 'exec' }, ({ channel }) => {
        expect(channel).toBeTruthy();
        client.close();
      });
    });
  });

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    () => {
      done();
    },
  );
});

test('client reconnects unexpected disconnects', (done) => {
  const client = new Client();

  let disconnectTriggered = false;
  let timesConnected = 0;
  let timesClosedUnintentionally = 0;
  let timesClosedIntentionally = 0;

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(error).toEqual(null);
      expect(channel?.status).toEqual('open');

      timesConnected += 1;

      if (!disconnectTriggered) {
        setTimeout(() => {
          // eslint-disable-next-line
          // @ts-ignore: trigger unintentional disconnect
          client.ws?.close();
          disconnectTriggered = true;
        });
      } else {
        client.close();
      }

      return (closeReason) => {
        if (closeReason.initiator !== 'client') {
          throw new Error('Expected "client" initiator');
        }

        if (closeReason.willReconnect) {
          timesClosedUnintentionally += 1;
        } else if (closeReason.willReconnect === false) {
          timesClosedIntentionally += 1;
        }

        if (timesConnected === 2) {
          expect(timesClosedUnintentionally).toEqual(1);
          expect(timesClosedIntentionally).toEqual(1);

          done();
        }
      };
    },
  );
});

test('client is closed while reconnecting', (done) => {
  const onOpen = jest.fn();

  const client = new Client();
  client.setDebugFunc((log) => {
    if (log.type === 'breadcrumb' && log.message === 'reconnecting') {
      setTimeout(() => {
        client.close();
      });
    }
  });

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel }) => {
      if (channel) {
        // called once after initial connect
        onOpen();

        setTimeout(() => {
          // eslint-disable-next-line
          // @ts-ignore: trigger unintentional disconnect
          client.ws?.close();
        });
      }

      return () => {
        expect(onOpen).toHaveBeenCalledTimes(1);
        done();
      };
    },
  );
});

test('closing before ever connecting', (done) => {
  const client = new Client();
  client.setDebugFunc((log) => {
    if (log.type === 'breadcrumb' && log.message === 'connecting') {
      setTimeout(() => {
        client.close();
      });
    }
  });

  const open = jest.fn();
  const openError = jest.fn();
  const close = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ error }) => {
      if (error) {
        openError();
        expect(open).not.toHaveBeenCalled();
        expect(openError).toHaveBeenCalledTimes(1);
        expect(close).not.toHaveBeenCalled();

        // the client will not ever successfully connect, so this cannot be
        // called in the callback.
        done();
      } else {
        open();
      }

      return () => {
        close();
      };
    },
  );
});

test('fallback to polling', (done) => {
  const client = new Client();

  class WebsocketThatNeverConnects {
    static OPEN = 1;
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  expect(() => getWebSocketClass(WebsocketThatNeverConnects)).not.toThrow();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  expect(getWebSocketClass(WebsocketThatNeverConnects)).toEqual(WebsocketThatNeverConnects);

  let didLogFallback = false;
  client.setDebugFunc((log) => {
    if (log.type === 'breadcrumb' && log.message === 'polling fallback') {
      didLogFallback = true;
    }
  });

  client.open(
    {
      timeout: 2000,
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      WebSocketClass: WebsocketThatNeverConnects,
      context: null,
    },
    ({ channel, error }) => {
      expect(error).toBeNull();
      expect(channel).not.toBeNull();
      expect(didLogFallback).toBe(true);
      client.close();

      return () => {
        done();
      };
    },
  );
}, 40000);

test('fetch token fail', (done) => {
  const chan0Cb = jest.fn();
  const client = new Client();

  client.setUnrecoverableErrorHandler((e) => {
    expect(chan0Cb).toHaveBeenCalledTimes(1);
    expect(e.message).toContain('fail');

    done();
  });

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          error: new Error('fail'),
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    chan0Cb,
  );
});

test('fetch abort signal works as expected', (done) => {
  const client = new Client();

  const onAbort = jest.fn();

  client.open(
    {
      fetchConnectionMetadata: (abortSignal) =>
        new Promise((r) => {
          // Listen to abort signal
          abortSignal.onabort = () => {
            onAbort();
            r({
              error: FetchConnectionMetadataError.Aborted,
            });
          };

          // closing client should trigger the abort signal
          setTimeout(() => {
            client.close();
          }, 0);
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(channel).toBe(null);
      expect(error).toBeTruthy();
      expect(error?.message).toBe('Failed to open');
      expect(onAbort).toHaveBeenCalledTimes(1);

      // The client will not ever successfully connect, so this cannot be
      // called in the callback.
      done();

      return () => {};
    },
  );
});

test('can close and open in synchronously without aborting fetch token', (done) => {
  const client = new Client();

  const onAbort = jest.fn();
  const firstChan0Cb = jest.fn();

  let resolveFetchToken: null | ((result: FetchConnectionMetadataResult) => void) = null;
  client.open(
    {
      // never resolves
      fetchConnectionMetadata: (abortSignal) =>
        new Promise((r) => {
          resolveFetchToken = r;

          abortSignal.onabort = () => {
            onAbort();
            // don't resolve
          };
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    firstChan0Cb,
  );

  client.close();

  expect(resolveFetchToken).toBeTruthy();
  // resolving the first fetch token later shouldn't casue any errors
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  resolveFetchToken!({ error: FetchConnectionMetadataError.Aborted });
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(firstChan0Cb).toHaveBeenCalledTimes(1);
  expect(firstChan0Cb).toHaveBeenLastCalledWith(
    expect.objectContaining({
      channel: null,
      context: null,
      error: expect.any(Error),
    }),
  );

  client.open(
    {
      fetchConnectionMetadata: () =>
        Promise.resolve({
          ...genConnectionMetadata(),
          error: null,
        }),
      WebSocketClass: WebSocket,
      context: null,
    },
    ({ channel, error }) => {
      expect(channel?.status).toBe('open');
      expect(error).toEqual(null);

      client.close();

      return () => {
        expect(firstChan0Cb).toHaveBeenCalledTimes(1);

        done();
      };
    },
  );
});
