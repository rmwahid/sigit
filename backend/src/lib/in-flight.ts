// Admission gate for operations that hold a large buffer in the shared process.
// A request budget bounds how many requests are accepted over time, but not how
// many are in flight at once: several admitted requests can all be holding their
// payload at the same moment. This gate bounds that overlap, and it fails fast
// instead of queueing, so the caller learns the server is busy rather than
// waiting behind work it cannot see.
export type InFlightGate = {
  // Returns the release function, or null when the gate is full.
  tryAcquire: () => (() => void) | null;
  activeCount: () => number;
};

export function createInFlightGate(limit: number): InFlightGate {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Gate limit must be a positive integer");
  let active = 0;
  return {
    tryAcquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        // Releasing twice would let the gate admit more work than its limit.
        if (released) return;
        released = true;
        active -= 1;
      };
    },
    activeCount: () => active,
  };
}
