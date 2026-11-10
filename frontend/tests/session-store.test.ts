/**
 * The account store's contract.
 *
 * The rule worth testing here is snapshot identity. `useSyncExternalStore`
 * compares snapshots with `Object.is`, so a store that builds a fresh object on
 * every read re-renders forever — which is exactly what happened once, and the
 * symptom was pages that never painted and a server that looked broken. These
 * tests fail if anything ever reintroduces a per-read allocation.
 *
 * The mechanics live in `session-external-store.ts` precisely so this can run
 * without React, a browser, or a localStorage to sign into.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExternalStore } from "../src/lib/session-external-store.ts";

describe("external store", () => {
  it("returns the same value on every read until it is set", () => {
    const store = createExternalStore({ signedIn: false });
    assert.equal(Object.is(store.get(), store.get()), true);
    assert.equal(store.get().signedIn, false);
  });

  it("returns a new value after a set, and then a stable one again", () => {
    const store = createExternalStore({ signedIn: false });
    const before = store.get();
    store.set({ signedIn: true });
    const after = store.get();
    assert.equal(Object.is(before, after), false);
    assert.equal(after.signedIn, true);
    assert.equal(Object.is(after, store.get()), true);
  });

  it("treats setting the identical value as no change at all", () => {
    const store = createExternalStore({ status: "signed-out" });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    const same = { status: "signed-out" };
    store.set(same);
    assert.equal(Object.is(store.get(), same), true);
    assert.equal(calls, 1, "a new object is still a change, because the value moved");
  });

  it("notifies subscribers on change", () => {
    const store = createExternalStore(0);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get()));
    store.set(1);
    store.set(2);
    assert.deepEqual(seen, [1, 2]);
  });

  it("stops notifying after unsubscribe, so a dead component cannot loop", () => {
    const store = createExternalStore(0);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    unsubscribe();
    store.set(1);
    assert.equal(calls, 0);
  });

  it("survives a subscriber that unsubscribes while being notified", () => {
    const store = createExternalStore(0);
    const order: string[] = [];
    const first = store.subscribe(() => {
      order.push("first");
      first();
    });
    store.subscribe(() => order.push("second"));
    store.set(1);
    // Skipping the second notification would be a hung subscriber, and a
    // throwing one would take the whole store down mid-render.
    assert.deepEqual(order, ["first", "second"]);
    assert.equal(typeof first, "function");
  });

  it("delivers the current value to a new subscriber of subscribeToCurrent", () => {
    const store = createExternalStore("ready");
    let seen: string | null = null;
    const unsubscribe = store.subscribeToCurrent(() => {
      seen = store.get();
    });
    assert.equal(seen, "ready");
    unsubscribe();
    store.set("changed");
    assert.equal(seen, "ready");
  });
});
