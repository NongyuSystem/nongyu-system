import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { insertEvent } from "./events.js";
import { openStore } from "./db.js";
import {
  bumpPeak,
  getMetricMap,
  percentile,
  perfDimsInRange,
  perfDurationsInRange,
} from "./metrics.js";

describe("perfDimsInRange", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  function open() {
    const dir = mkdtempSync(join(tmpdir(), "ny-perf-"));
    dirs.push(dir);
    return openStore(join(dir, "track.db"));
  }

  function insertPerf(
    store: ReturnType<typeof openStore>,
    id: string,
    date: string,
    name: string,
    ms: number,
    platform = "android",
  ) {
    insertEvent(store, {
      eventId: id,
      userId: 1,
      studentNo: "S1",
      eventType: "perf",
      eventName: name,
      appVersion: "1.0.0",
      platform,
      deviceBrand: "test",
      sessionId: "s",
      durationMs: ms,
      propsJson: "",
      clientTsMs: Date.now(),
      receivedAtMs: Date.now(),
      statDate: date,
    });
  }

  it("recomputes percentile across days (not average of daily p50)", () => {
    const store = open();
    // day1: 100,200 → day p50=100 (ceil(0.5*2)-1=0)
    insertPerf(store, "a1", "2026-09-01", "course_week_first_paint", 100);
    insertPerf(store, "a2", "2026-09-01", "course_week_first_paint", 200);
    // day2: 300,400,500 → day p50=400
    insertPerf(store, "b1", "2026-09-02", "course_week_first_paint", 300);
    insertPerf(store, "b2", "2026-09-02", "course_week_first_paint", 400);
    insertPerf(store, "b3", "2026-09-02", "course_week_first_paint", 500);

    const merged = [100, 200, 300, 400, 500].sort((a, b) => a - b);
    const expectedP50 = percentile(merged, 50);
    const dayP50Avg = Math.round((100 + 400) / 2);

    const rows = perfDimsInRange(store, "perf_p50", "2026-09-01", "2026-09-02", 50);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dimValue).toBe("course_week_first_paint");
    expect(rows[0]!.metricValue).toBe(expectedP50);
    expect(rows[0]!.metricValue).not.toBe(dayP50Avg);

    store.close();
  });

  it("excludes web by default", () => {
    const store = open();
    insertPerf(store, "c1", "2026-09-01", "course_week_first_paint", 100, "android");
    insertPerf(store, "c2", "2026-09-01", "cwv_lcp", 999, "web");
    const map = perfDurationsInRange(store, "2026-09-01", "2026-09-01", {
      excludePlatform: "web",
    });
    expect(map.has("course_week_first_paint")).toBe(true);
    expect(map.has("cwv_lcp")).toBe(false);
    store.close();
  });
});

describe("bumpPeak first occurrence", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  function open() {
    const dir = mkdtempSync(join(tmpdir(), "ny-peak-"));
    dirs.push(dir);
    return openStore(join(dir, "track.db"));
  }

  it("records first rise and ignores ties or drops", () => {
    const store = open();
    const date = "2026-09-16";
    bumpPeak(store, date, 0, 1000);
    expect(getMetricMap(store, date)).toEqual({ online_peak: 0 });

    bumpPeak(store, date, 10, 2000);
    expect(getMetricMap(store, date)).toEqual({ online_peak: 10, online_peak_at_ms: 2000 });

    bumpPeak(store, date, 10, 3000);
    expect(getMetricMap(store, date).online_peak_at_ms).toBe(2000);

    bumpPeak(store, date, 8, 4000);
    expect(getMetricMap(store, date)).toEqual({ online_peak: 10, online_peak_at_ms: 2000 });

    bumpPeak(store, date, 12, 5000);
    expect(getMetricMap(store, date)).toEqual({ online_peak: 12, online_peak_at_ms: 5000 });
    store.close();
  });
});
