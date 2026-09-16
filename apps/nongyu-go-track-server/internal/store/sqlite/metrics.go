package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
)

type Metric struct {
	StatDate string
	Key      string
	Value    int64
}

type DimRow struct {
	DimKey      string
	DimValue    string
	MetricValue int64
}

type CrashRow struct {
	EventID      string
	UserID       sql.NullInt64
	StudentNo    sql.NullString
	EventName    string
	AppVersion   sql.NullString
	Platform     sql.NullString
	DeviceBrand  sql.NullString
	ClientTsMs   sql.NullInt64
	ReceivedAtMs int64
	StatDate     string
	PropsJSON    sql.NullString
}

func (s *Store) UpsertMetric(ctx context.Context, tx *sql.Tx, date, key string, value, nowMs int64) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO daily_metrics (stat_date, metric_key, metric_value, updated_at_ms)
VALUES (?, ?, ?, ?)
ON CONFLICT(stat_date, metric_key) DO UPDATE SET
  metric_value=excluded.metric_value,
  updated_at_ms=excluded.updated_at_ms`, date, key, value, nowMs)
	if err != nil {
		return fmt.Errorf("upsert metric %s: %w", key, err)
	}
	return nil
}

// BumpPeak 在采样高于当日峰值时更新 online_peak，并记下首次达到该值的 UTC ms。
func (s *Store) BumpPeak(ctx context.Context, date string, sample, nowMs int64) error {
	return s.WithWriteTx(ctx, func(tx *sql.Tx) error {
		var current sql.NullInt64
		err := tx.QueryRowContext(ctx, `
SELECT metric_value FROM daily_metrics WHERE stat_date=? AND metric_key='online_peak'`, date).Scan(&current)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		// 无行且样本为 0：只记峰值 0，不写时刻（尚未形成有意义峰值）
		if !current.Valid {
			if err := s.UpsertMetric(ctx, tx, date, "online_peak", sample, nowMs); err != nil {
				return err
			}
			if sample <= 0 {
				return nil
			}
			return s.UpsertMetric(ctx, tx, date, "online_peak_at_ms", nowMs, nowMs)
		}
		// 未升高：并列取首次，下降忽略；禁止用 nowMs 刷新冒充峰值时刻
		if sample <= current.Int64 {
			return nil
		}
		if err := s.UpsertMetric(ctx, tx, date, "online_peak", sample, nowMs); err != nil {
			return err
		}
		return s.UpsertMetric(ctx, tx, date, "online_peak_at_ms", nowMs, nowMs)
	})
}

func (s *Store) ReplaceDims(ctx context.Context, tx *sql.Tx, date, metricKey string, nowMs int64, rows []DimRow) error {
	if _, err := tx.ExecContext(ctx, `
DELETE FROM daily_dims WHERE stat_date=? AND metric_key=?`, date, metricKey); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := tx.ExecContext(ctx, `
INSERT INTO daily_dims (stat_date, metric_key, dim_key, dim_value, metric_value, updated_at_ms)
VALUES (?, ?, ?, ?, ?, ?)`, date, metricKey, row.DimKey, row.DimValue, row.MetricValue, nowMs); err != nil {
			return fmt.Errorf("insert dim: %w", err)
		}
	}
	return nil
}

func (s *Store) GetMetricMap(ctx context.Context, date string) (map[string]int64, error) {
	rows, err := s.read.QueryContext(ctx, `
SELECT metric_key, metric_value FROM daily_metrics WHERE stat_date=?`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var v int64
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (s *Store) Trend(ctx context.Context, metric, from, to string) ([]Metric, error) {
	rows, err := s.read.QueryContext(ctx, `
SELECT stat_date, metric_key, metric_value FROM daily_metrics
WHERE metric_key=? AND stat_date>=? AND stat_date<=?
ORDER BY stat_date ASC`, metric, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Metric, 0)
	for rows.Next() {
		var m Metric
		if err := rows.Scan(&m.StatDate, &m.Key, &m.Value); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) Dims(ctx context.Context, metric, date string, limit int) ([]DimRow, error) {
	rows, err := s.read.QueryContext(ctx, `
SELECT dim_key, dim_value, metric_value FROM daily_dims
WHERE stat_date=? AND metric_key=?
ORDER BY metric_value DESC, dim_value ASC
LIMIT ?`, date, metric, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DimRow, 0)
	for rows.Next() {
		var d DimRow
		if err := rows.Scan(&d.DimKey, &d.DimValue, &d.MetricValue); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// LiveDims 从当日 events 实时汇总维度（今日 overview/大屏用；不依赖 daily_dims）。
func (s *Store) LiveDims(ctx context.Context, metric, date string, limit int) ([]DimRow, error) {
	if limit < 1 {
		limit = 50
	}
	q := s.ReadDB()
	var rows []DimRow
	var err error
	switch metric {
	case "screen_views":
		// 进入次数：enter 无 duration_ms，避免与 leave 双计
		rows, err = s.CountScreenEnters(ctx, q, date)
	case "screen_dwell_avg":
		rows, err = s.AvgScreenDwell(ctx, q, date)
	case "button_clicks":
		rows, err = s.CountByName(ctx, q, date, "button_click")
	case "perf_p50", "perf_p95":
		perf, perr := s.PerfDurations(ctx, q, date)
		if perr != nil {
			return nil, perr
		}
		p := 50.0
		if metric == "perf_p95" {
			p = 95.0
		}
		rows = make([]DimRow, 0, len(perf))
		for name, vals := range perf {
			sorted := append([]int64(nil), vals...)
			sort.Slice(sorted, func(i, k int) bool { return sorted[i] < sorted[k] })
			rows = append(rows, DimRow{DimKey: "name", DimValue: name, MetricValue: Percentile(sorted, p)})
		}
	default:
		return nil, fmt.Errorf("unsupported live dim metric %s", metric)
	}
	if err != nil {
		return nil, err
	}
	sort.Slice(rows, func(i, k int) bool {
		if rows[i].MetricValue == rows[k].MetricValue {
			return rows[i].DimValue < rows[k].DimValue
		}
		return rows[i].MetricValue > rows[k].MetricValue
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

// Percentile 对已排序样本取分位（与日聚合口径一致）。
func Percentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func (s *Store) ListCrashes(ctx context.Context, from, to string, offset, limit int) ([]CrashRow, int, error) {
	return s.listEventsByType(ctx, "crash", from, to, "", offset, limit)
}

// ListLlmProxyFails 列出平台 LLM 代理失败事件；errorCode 为空则不过滤 event_name。
func (s *Store) ListLlmProxyFails(ctx context.Context, from, to, errorCode string, offset, limit int) ([]CrashRow, int, error) {
	return s.listEventsByType(ctx, "llm_proxy_fail", from, to, errorCode, offset, limit)
}

func (s *Store) listEventsByType(
	ctx context.Context,
	eventType, from, to, eventName string,
	offset, limit int,
) ([]CrashRow, int, error) {
	countSQL := `SELECT COUNT(*) FROM events WHERE event_type=? AND stat_date>=? AND stat_date<=?`
	listSQL := `
SELECT event_id, user_id, student_no, event_name, app_version, platform, device_brand,
       client_ts_ms, received_at_ms, stat_date, props_json
FROM events
WHERE event_type=? AND stat_date>=? AND stat_date<=?`
	argsCount := []any{eventType, from, to}
	argsList := []any{eventType, from, to}
	if eventName != "" {
		countSQL += ` AND event_name=?`
		listSQL += ` AND event_name=?`
		argsCount = append(argsCount, eventName)
		argsList = append(argsList, eventName)
	}
	listSQL += ` ORDER BY received_at_ms DESC LIMIT ? OFFSET ?`
	argsList = append(argsList, limit, offset)

	var total int
	if err := s.read.QueryRowContext(ctx, countSQL, argsCount...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.read.QueryContext(ctx, listSQL, argsList...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]CrashRow, 0)
	for rows.Next() {
		var c CrashRow
		if err := rows.Scan(
			&c.EventID, &c.UserID, &c.StudentNo, &c.EventName, &c.AppVersion, &c.Platform,
			&c.DeviceBrand, &c.ClientTsMs, &c.ReceivedAtMs, &c.StatDate, &c.PropsJSON,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}

func (s *Store) CountDistinctDAU(ctx context.Context, q dbQuerier, date string) (int64, error) {
	var n int64
	err := q.QueryRowContext(ctx, `
SELECT COUNT(DISTINCT user_id) FROM events
WHERE stat_date=? AND event_type='app_open' AND user_id IS NOT NULL`, date).Scan(&n)
	return n, err
}

func (s *Store) CountByType(ctx context.Context, q dbQuerier, date, eventType string) (int64, error) {
	var n int64
	err := q.QueryRowContext(ctx, `
SELECT COUNT(*) FROM events WHERE stat_date=? AND event_type=?`, date, eventType).Scan(&n)
	return n, err
}

func (s *Store) CountByName(ctx context.Context, q dbQuerier, date, eventType string) ([]DimRow, error) {
	rows, err := q.QueryContext(ctx, `
SELECT event_name, COUNT(*) FROM events
WHERE stat_date=? AND event_type=?
GROUP BY event_name`, date, eventType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DimRow, 0)
	for rows.Next() {
		var d DimRow
		d.DimKey = "name"
		if err := rows.Scan(&d.DimValue, &d.MetricValue); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// CountScreenEnters 按 pathname 统计页面进入次数（无 duration_ms 的 screen_view）。
func (s *Store) CountScreenEnters(ctx context.Context, q dbQuerier, date string) ([]DimRow, error) {
	rows, err := q.QueryContext(ctx, `
SELECT event_name, COUNT(*) FROM events
WHERE stat_date=? AND event_type='screen_view' AND duration_ms IS NULL
GROUP BY event_name`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DimRow, 0)
	for rows.Next() {
		var d DimRow
		d.DimKey = "name"
		if err := rows.Scan(&d.DimValue, &d.MetricValue); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// AvgScreenDwell 按 pathname 对 leave 的 duration_ms 求平均（整数毫秒）。
func (s *Store) AvgScreenDwell(ctx context.Context, q dbQuerier, date string) ([]DimRow, error) {
	rows, err := q.QueryContext(ctx, `
SELECT event_name, CAST(ROUND(AVG(duration_ms)) AS INTEGER) FROM events
WHERE stat_date=? AND event_type='screen_view' AND duration_ms IS NOT NULL
GROUP BY event_name`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DimRow, 0)
	for rows.Next() {
		var d DimRow
		d.DimKey = "name"
		if err := rows.Scan(&d.DimValue, &d.MetricValue); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) PerfDurations(ctx context.Context, q dbQuerier, date string) (map[string][]int64, error) {
	rows, err := q.QueryContext(ctx, `
SELECT event_name, duration_ms FROM events
WHERE stat_date=? AND event_type='perf' AND duration_ms IS NOT NULL`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]int64{}
	for rows.Next() {
		var name string
		var ms int64
		if err := rows.Scan(&name, &ms); err != nil {
			return nil, err
		}
		out[name] = append(out[name], ms)
	}
	return out, rows.Err()
}

func (s *Store) PurgeEvents(ctx context.Context, cutoffMs int64) (int64, error) {
	var deleted int64
	err := s.WithWriteTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM events WHERE received_at_ms < ?`, cutoffMs)
		if err != nil {
			return err
		}
		deleted, err = res.RowsAffected()
		return err
	})
	if err != nil {
		return 0, err
	}
	_, _ = s.write.ExecContext(ctx, "PRAGMA optimize")
	return deleted, nil
}

func (s *Store) RecordJob(ctx context.Context, name, key, status string, nowMs int64, detail string) error {
	_, err := s.write.ExecContext(ctx, `
INSERT INTO meta_jobs (job_name, job_key, status, finished_at_ms, detail_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(job_name, job_key) DO UPDATE SET
  status=excluded.status,
  finished_at_ms=excluded.finished_at_ms,
  detail_json=excluded.detail_json`, name, key, status, nowMs, nullIfEmpty(detail))
	return err
}

func (s *Store) JobStatus(ctx context.Context, name, key string) (string, bool, error) {
	var status string
	err := s.read.QueryRowContext(ctx, `
SELECT status FROM meta_jobs WHERE job_name=? AND job_key=?`, name, key).Scan(&status)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return status, true, nil
}

type dbQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
