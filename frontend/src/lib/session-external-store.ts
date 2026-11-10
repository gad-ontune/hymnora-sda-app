/**
 * The mechanics of the account store, with no React and no browser in it.
 *
 * Split out for the same reason `notes-geometry.ts` exists: the part that can be
 * *proved* should be separable from the part that has to *run*. This file has no
 * imports at all, so the tests can load it directly, and `session-store.ts` is
 * left with nothing but the network calls and the hook.
 *
 * The one rule encoded here is that state is replaced and never mutated. A
 * store that hands out a fresh object per read makes `useSyncExternalStore`
 * re-render forever, because it compares snapshots with `Object.is`. That bug
 * shipped once, and it looked like the whole server was down.
 */

export type StoreListener = () => void;

export type ExternalStore<T> = {
  /** The current value. The same reference until something actually changes. */
  get: () => T;
  /** Replaces the value and tells every subscriber. */
  set: (next: T) => void;
  subscribe: (listener: StoreListener) => () => void;
  /** Notified immediately with the current value, like `useSyncExternalStore`. */
  subscribeToCurrent: (listener: StoreListener) => () => void;
};

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let state = initial;
  const listeners = new Set<StoreListener>();

  return {
    get: () => state,
    set: (next: T) => {
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: StoreListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeToCurrent: (listener: StoreListener) => {
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
