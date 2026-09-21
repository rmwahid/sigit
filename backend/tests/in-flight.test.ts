// Paired test for lib/in-flight.ts: the admission gate that bounds how many
// large-buffer operations one backend process runs at the same time.
import { describe, expect, it } from "bun:test";
import { createInFlightGate } from "@/lib/in-flight";

describe("createInFlightGate", () => {
  it("admits up to the limit and refuses the next call", () => {
    const gate = createInFlightGate(2);
    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.activeCount()).toBe(2);
    // Full: the caller gets null and decides what to answer, instead of queueing.
    expect(gate.tryAcquire()).toBeNull();
  });

  it("admits again once a holder releases", () => {
    const gate = createInFlightGate(1);
    const release = gate.tryAcquire()!;
    expect(gate.tryAcquire()).toBeNull();
    release();
    expect(gate.activeCount()).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
  });

  it("ignores a repeated release from the same holder", () => {
    const gate = createInFlightGate(1);
    const release = gate.tryAcquire()!;
    release();
    release();
    expect(gate.activeCount()).toBe(0);
    const held = gate.tryAcquire();
    expect(held).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });

  it("rejects a limit that would admit nothing", () => {
    expect(() => createInFlightGate(0)).toThrow();
    expect(() => createInFlightGate(1.5)).toThrow();
  });
});
