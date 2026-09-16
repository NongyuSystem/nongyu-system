import { Button, InputNumber, message } from "antd";
import { useEffect, useState } from "react";
import { AdminApiError, fetchTrackSampleRate, updateTrackSampleRate } from "../../lib/adminApi";

type TrackSampleRateBarProps = {
  visible: boolean;
};

/**
 * 数据大屏顶部：超管低调配置埋点采样率（0–100）
 */
export function TrackSampleRateBar({ visible }: TrackSampleRateBarProps) {
  const [value, setValue] = useState(100);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    void fetchTrackSampleRate()
      .then((rate: number) => {
        if (!cancelled) setValue(rate);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const text = err instanceof AdminApiError ? err.serverMessage : "加载采样率失败";
        message.error(text);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible) return null;

  async function handleSave() {
    if (value === null || value < 0 || value > 100) {
      message.warning("采样率须在 0–100 之间");
      return;
    }
    setSaving(true);
    try {
      const rate = await updateTrackSampleRate(value);
      setValue(rate);
      message.success("采样率已保存");
    } catch (err) {
      const text = err instanceof AdminApiError ? err.serverMessage : "保存失败，请稍后重试";
      message.error(text);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ny-glass mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted">
      <span className="text-ink">埋点采样率</span>
      <InputNumber
        min={0}
        max={100}
        precision={0}
        value={value}
        disabled={loading || saving}
        onChange={(next) => {
          if (typeof next === "number") setValue(next);
        }}
        addonAfter="%"
        className="w-28"
      />
      <Button
        type="primary"
        size="small"
        loading={saving}
        disabled={loading}
        onClick={() => void handleSave()}
      >
        保存
      </Button>
      <span className="text-xs text-muted">行为类事件按 session 采样；崩溃与心跳始终全量</span>
    </div>
  );
}
