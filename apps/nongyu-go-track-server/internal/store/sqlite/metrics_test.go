package sqlite

import (
	"context"
	"path/filepath"
	"testing"
)

func TestBumpPeakFirstOccurrence(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, filepath.Join(t.TempDir(), "track.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	date := "2026-09-16"
	if err := store.BumpPeak(ctx, date, 0, 1000); err != nil {
		t.Fatal(err)
	}
	m, err := store.GetMetricMap(ctx, date)
	if err != nil {
		t.Fatal(err)
	}
	if m["online_peak"] != 0 {
		t.Fatalf("peak after zero sample: %v", m)
	}
	if _, ok := m["online_peak_at_ms"]; ok {
		t.Fatalf("zero sample must not write peak at: %v", m)
	}

	if err := store.BumpPeak(ctx, date, 10, 2000); err != nil {
		t.Fatal(err)
	}
	m, err = store.GetMetricMap(ctx, date)
	if err != nil {
		t.Fatal(err)
	}
	if m["online_peak"] != 10 || m["online_peak_at_ms"] != 2000 {
		t.Fatalf("first rise: %v", m)
	}

	if err := store.BumpPeak(ctx, date, 10, 3000); err != nil {
		t.Fatal(err)
	}
	m, err = store.GetMetricMap(ctx, date)
	if err != nil {
		t.Fatal(err)
	}
	if m["online_peak_at_ms"] != 2000 {
		t.Fatalf("tie must keep first at, got %d", m["online_peak_at_ms"])
	}

	if err := store.BumpPeak(ctx, date, 8, 4000); err != nil {
		t.Fatal(err)
	}
	m, err = store.GetMetricMap(ctx, date)
	if err != nil {
		t.Fatal(err)
	}
	if m["online_peak"] != 10 || m["online_peak_at_ms"] != 2000 {
		t.Fatalf("lower sample must not change: %v", m)
	}

	if err := store.BumpPeak(ctx, date, 12, 5000); err != nil {
		t.Fatal(err)
	}
	m, err = store.GetMetricMap(ctx, date)
	if err != nil {
		t.Fatal(err)
	}
	if m["online_peak"] != 12 || m["online_peak_at_ms"] != 5000 {
		t.Fatalf("new high must update at: %v", m)
	}
}
