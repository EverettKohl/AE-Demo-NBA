import { buildCoverage, dedupeCandidates, durationKey } from "@/lib/slotCurator";

describe("slotCurator helpers", () => {
  it("dedupes candidates by id/start/end", () => {
    const deduped = dedupeCandidates([
      { videoId: "a", start: 0, end: 1, durationSeconds: 1 },
      { videoId: "a", start: 0, end: 1, durationSeconds: 1 },
      { videoId: "b", start: 0.5, end: 1.5, durationSeconds: 1 },
      { indexId: "idx-1", start: 0, end: 1, durationSeconds: 1 },
    ]);
    expect(deduped).toHaveLength(3);
  });

  it("builds coverage keyed by exact duration", () => {
    const coverage = buildCoverage([
      { slot: 0, targetDuration: 1.23, candidates: [{ durationSeconds: 1.23, start: 0, end: 1.23 }] },
      { slot: 1, targetDuration: 1.23, candidates: [{ durationSeconds: 1.23, start: 0, end: 1.23 }] },
      { slot: 2, targetDuration: 2.5, candidates: [] },
    ]);
    expect(coverage["1.23"].slotCount).toBe(2);
    expect(coverage["1.23"].candidateCount).toBe(2);
    expect(coverage["2.5"].slotCount).toBe(1);
  });

  it("keeps decimal precision for durationKey", () => {
    expect(durationKey(1.23456)).toBe("1.23456");
    expect(durationKey(0.7)).toBe("0.7");
    expect(durationKey(2)).toBe("2");
  });
});
