import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePendingAction } from './usePendingAction';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePendingAction', () => {
  it('is pending from the call until the action settles', async () => {
    const { result } = renderHook(() => usePendingAction());
    const d = deferred();

    let done;
    act(() => {
      done = result.current.run(() => d.promise);
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      d.resolve({ success: true });
      expect(await done).toEqual({ success: true });
    });
    expect(result.current.pending).toBe(false);
  });

  it('ignores calls while one is in flight', async () => {
    const { result } = renderHook(() => usePendingAction());
    const d = deferred();
    let calls = 0;
    const action = () => {
      calls += 1;
      return d.promise;
    };

    let first;
    let second;
    act(() => {
      first = result.current.run(action);
      second = result.current.run(action);
    });
    expect(calls).toBe(1);
    expect(await second).toBeUndefined();

    await act(async () => {
      d.resolve('ok');
      await first;
    });
    expect(calls).toBe(1);
  });

  it('records which key is pending', async () => {
    const { result } = renderHook(() => usePendingAction());
    const d = deferred();

    let done;
    act(() => {
      done = result.current.run(() => d.promise, 'player-2');
    });
    expect(result.current.pendingKey).toBe('player-2');

    await act(async () => {
      d.resolve();
      await done;
    });
    expect(result.current.pendingKey).toBeNull();
  });

  it('clears pending and rethrows when the action fails', async () => {
    const { result } = renderHook(() => usePendingAction());
    const d = deferred();

    let done;
    act(() => {
      done = result.current.run(() => d.promise);
    });

    await act(async () => {
      d.reject(new Error('offline'));
      await expect(done).rejects.toThrow('offline');
    });
    expect(result.current.pending).toBe(false);

    // A new call is accepted after the failure.
    let calls = 0;
    await act(async () => {
      await result.current.run(async () => {
        calls += 1;
      });
    });
    expect(calls).toBe(1);
  });
});
