package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nongyu-go-track-server/internal/bizday"
	"nongyu-go-track-server/internal/sqlguard"
	"nongyu-go-track-server/internal/store/sqlite"
)

var allowedTrend = map[string]struct{}{
	"dau": {}, "crash_count": {}, "app_open_count": {}, "screen_view_count": {}, "online_peak": {},
}

var allowedDims = map[string]struct{}{
	"screen_views": {}, "screen_dwell_avg": {}, "button_clicks": {}, "perf_p50": {}, "perf_p95": {},
}

func (a *API) handleOverview(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if _, err := bizday.ParseDate(date); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid date")
		return
	}
	ctx := r.Context()
	// 今日日聚合要到次日 00:10 才落库；若误用/联调写过当日 daily_metrics，
	// 旧条件（dau==0 && app_open_count==0）会跳过 live，日活会一直卡在错误的 0。
	if bizday.IsToday(date, a.now()) {
		if live, ok := a.liveOverview(date); ok {
			writeOK(w, http.StatusOK, live)
			return
		}
		dau, err1 := a.store.CountDistinctDAU(ctx, a.store.ReadDB(), date)
		appOpen, err2 := a.store.CountByType(ctx, a.store.ReadDB(), date, "app_open")
		screens, err3 := a.store.CountByType(ctx, a.store.ReadDB(), date, "screen_view")
		clicks, err4 := a.store.CountByType(ctx, a.store.ReadDB(), date, "button_click")
		crashes, err5 := a.store.CountByType(ctx, a.store.ReadDB(), date, "crash")
		onlinePeak, peakAtMs, err6 := a.liveOnlinePeak(ctx, date)
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil || err6 != nil {
			writeFail(w, http.StatusInternalServerError, "INTERNAL", "live query failed")
			return
		}
		live := map[string]any{
			"date":               date,
			"dau":                dau,
			"crash_count":        crashes,
			"app_open_count":     appOpen,
			"screen_view_count":  screens,
			"button_click_count": clicks,
			"online_peak":        onlinePeak,
			"online_peak_at_ms":  peakAtMs,
		}
		// 空结果不缓存，避免「先查到 0 → 事件刚写入仍吃缓存」
		if dau > 0 || appOpen > 0 || screens > 0 || clicks > 0 || crashes > 0 || onlinePeak > 0 {
			a.cacheLive(date, live)
		}
		writeOK(w, http.StatusOK, live)
		return
	}

	metrics, err := a.store.GetMetricMap(ctx, date)
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "query failed")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{
		"date":               date,
		"dau":                metrics["dau"],
		"crash_count":        metrics["crash_count"],
		"app_open_count":     metrics["app_open_count"],
		"screen_view_count":  metrics["screen_view_count"],
		"button_click_count": metrics["button_click_count"],
		"online_peak":        metrics["online_peak"],
		"online_peak_at_ms":  metricAtOrNil(metrics),
	})
}

func (a *API) handleTrend(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("metric")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if _, ok := allowedTrend[metric]; !ok {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid metric")
		return
	}
	ft, err1 := bizday.ParseDate(from)
	tt, err2 := bizday.ParseDate(to)
	if err1 != nil || err2 != nil || ft.After(tt) {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid from/to")
		return
	}
	rows, err := a.store.Trend(r.Context(), metric, from, to)
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "query failed")
		return
	}
	points := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		points = append(points, map[string]any{"date": row.StatDate, "value": row.Value})
	}

	// 今日尚无日聚合；区间含今天时用 events / presence live 填今日点，避免趋势图今日恒为缺省/0
	today := bizday.StatDate(a.now())
	if from <= today && today <= to {
		live, liveErr := a.liveTrendValue(r.Context(), metric, today)
		if liveErr != nil {
			writeFail(w, http.StatusInternalServerError, "INTERNAL", "live trend failed")
			return
		}
		replaced := false
		for i := range points {
			if points[i]["date"] == today {
				points[i]["value"] = live
				replaced = true
				break
			}
		}
		if !replaced {
			points = append(points, map[string]any{"date": today, "value": live})
		}
	}

	writeOK(w, http.StatusOK, points)
}

func (a *API) liveTrendValue(ctx context.Context, metric, date string) (int64, error) {
	q := a.store.ReadDB()
	switch metric {
	case "dau":
		return a.store.CountDistinctDAU(ctx, q, date)
	case "app_open_count":
		return a.store.CountByType(ctx, q, date, "app_open")
	case "screen_view_count":
		return a.store.CountByType(ctx, q, date, "screen_view")
	case "crash_count":
		return a.store.CountByType(ctx, q, date, "crash")
	case "online_peak":
		online, err := a.store.CountOnline(ctx)
		if err != nil {
			return 0, err
		}
		metrics, err := a.store.GetMetricMap(ctx, date)
		if err != nil {
			return 0, err
		}
		peak := metrics["online_peak"]
		if online > peak {
			return online, nil
		}
		return peak, nil
	default:
		return 0, nil
	}
}

func metricAtOrNil(metrics map[string]int64) any {
	v, ok := metrics["online_peak_at_ms"]
	if !ok || v <= 0 {
		return nil
	}
	return v
}

// liveOnlinePeak 今日峰值人数与首次达到时刻。live 高于已存峰值时用请求时刻，不写库。
func (a *API) liveOnlinePeak(ctx context.Context, date string) (int64, any, error) {
	online, err := a.store.CountOnline(ctx)
	if err != nil {
		return 0, nil, err
	}
	metrics, err := a.store.GetMetricMap(ctx, date)
	if err != nil {
		return 0, nil, err
	}
	peak := metrics["online_peak"]
	at := metricAtOrNil(metrics)
	if online > peak {
		return online, a.now().UTC().UnixMilli(), nil
	}
	return peak, at, nil
}

func (a *API) handleDims(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("metric")
	date := r.URL.Query().Get("date")
	if _, ok := allowedDims[metric]; !ok {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid metric")
		return
	}
	if _, err := bizday.ParseDate(date); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid date")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid limit")
			return
		}
		if n > 100 {
			n = 100
		}
		limit = n
	}

	var rows []sqlite.DimRow
	var err error
	// 今日日聚合要到次日才落 daily_dims；大屏默认查今天，必须 live，否则永远空。
	if bizday.IsToday(date, a.now()) {
		rows, err = a.store.LiveDims(r.Context(), metric, date, limit)
	} else {
		rows, err = a.store.Dims(r.Context(), metric, date, limit)
	}
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "query failed")
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, map[string]any{
			"dim_key":      row.DimKey,
			"dim_value":    row.DimValue,
			"metric_value": row.MetricValue,
		})
	}
	writeOK(w, http.StatusOK, map[string]any{"date": date, "metric": metric, "items": items})
}

func (a *API) handleCrashes(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if _, err := bizday.ParseDate(from); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid from")
		return
	}
	if _, err := bizday.ParseDate(to); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid to")
		return
	}
	page := 1
	pageSize := 20
	if raw := r.URL.Query().Get("page"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid page")
			return
		}
		page = n
	}
	if raw := r.URL.Query().Get("page_size"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid page_size")
			return
		}
		if n > 100 {
			n = 100
		}
		pageSize = n
	}
	offset := (page - 1) * pageSize
	rows, total, err := a.store.ListCrashes(r.Context(), from, to, offset, pageSize)
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "query failed")
		return
	}
	list := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		list = append(list, map[string]any{
			"event_id":       c.EventID,
			"user_id":        nullInt64(c.UserID),
			"student_no":     nullString(c.StudentNo),
			"event_name":     c.EventName,
			"app_version":    nullString(c.AppVersion),
			"platform":       nullString(c.Platform),
			"device_brand":   nullString(c.DeviceBrand),
			"client_ts_ms":   nullInt64(c.ClientTsMs),
			"received_at_ms": c.ReceivedAtMs,
			"stat_date":      c.StatDate,
			"props":          parseProps(c.PropsJSON),
		})
	}
	writeOK(w, http.StatusOK, map[string]any{
		"list":      list,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func (a *API) handleLlmProxyFails(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if _, err := bizday.ParseDate(from); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid from")
		return
	}
	if _, err := bizday.ParseDate(to); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid to")
		return
	}
	errorCode := strings.TrimSpace(r.URL.Query().Get("error_code"))
	page := 1
	pageSize := 20
	if raw := r.URL.Query().Get("page"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid page")
			return
		}
		page = n
	}
	if raw := r.URL.Query().Get("page_size"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid page_size")
			return
		}
		if n > 100 {
			n = 100
		}
		pageSize = n
	}
	offset := (page - 1) * pageSize
	rows, total, err := a.store.ListLlmProxyFails(r.Context(), from, to, errorCode, offset, pageSize)
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "query failed")
		return
	}
	list := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		list = append(list, map[string]any{
			"event_id":       c.EventID,
			"user_id":        nullInt64(c.UserID),
			"student_no":     nullString(c.StudentNo),
			"event_name":     c.EventName,
			"app_version":    nullString(c.AppVersion),
			"platform":       nullString(c.Platform),
			"device_brand":   nullString(c.DeviceBrand),
			"client_ts_ms":   nullInt64(c.ClientTsMs),
			"received_at_ms": c.ReceivedAtMs,
			"stat_date":      c.StatDate,
			"props":          parseProps(c.PropsJSON),
		})
	}
	writeOK(w, http.StatusOK, map[string]any{
		"list":      list,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func (a *API) handleSQLQuery(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SQL string `json:"sql"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFail(w, http.StatusBadRequest, "INVALID_SQL", "invalid json")
		return
	}
	prepared, err := sqlguard.Prepare(body.SQL)
	if err != nil {
		writeFail(w, http.StatusBadRequest, "INVALID_SQL", err.Error())
		return
	}
	columns, rows, truncated, err := a.store.QueryReadOnly(
		r.Context(),
		prepared.ExecSQL,
		sqlguard.MaxRows,
	)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			writeFail(w, http.StatusGatewayTimeout, "TIMEOUT", "query timed out")
			return
		}
		a.log.Warn("sql query failed", "err", err)
		writeFail(w, http.StatusBadRequest, "INVALID_SQL", "sql execution failed")
		return
	}
	if columns == nil {
		columns = []string{}
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	writeOK(w, http.StatusOK, map[string]any{
		"sql":       prepared.ExecSQL,
		"columns":   columns,
		"rows":      rows,
		"truncated": truncated,
		"row_count": len(rows),
	})
}

func (a *API) handleAggregate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StatDate string `json:"stat_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid json")
		return
	}
	if _, err := bizday.ParseDate(body.StatDate); err != nil {
		writeFail(w, http.StatusBadRequest, "BAD_REQUEST", "invalid stat_date")
		return
	}
	status, err := a.jobs.RunAggregate(r.Context(), body.StatDate)
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "aggregate failed")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{
		"job_name": "aggregate_daily",
		"job_key":  "stat_date=" + body.StatDate,
		"status":   status,
	})
}

func (a *API) handlePurge(w http.ResponseWriter, r *http.Request) {
	n, err := a.jobs.RunPurge(r.Context())
	if err != nil {
		writeFail(w, http.StatusInternalServerError, "INTERNAL", "purge failed")
		return
	}
	writeOK(w, http.StatusOK, map[string]any{
		"job_name":         "purge_events",
		"status":           "success",
		"deleted_estimate": n,
	})
}

func nullInt64(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}

func nullString(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}

func parseProps(v sql.NullString) any {
	if !v.Valid || v.String == "" {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(v.String), &obj); err != nil {
		return nil
	}
	return obj
}

func (a *API) liveOverview(date string) (map[string]any, bool) {
	a.live.mu.Lock()
	defer a.live.mu.Unlock()
	if a.live.date == date && time.Since(a.live.at) < 5*time.Second {
		return a.live.value, true
	}
	return nil, false
}

func (a *API) cacheLive(date string, value map[string]any) {
	a.live.mu.Lock()
	a.live.date = date
	a.live.at = time.Now()
	a.live.value = value
	a.live.mu.Unlock()
}
