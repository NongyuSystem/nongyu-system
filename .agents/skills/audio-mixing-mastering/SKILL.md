---
name: audio-mixing-mastering
description: 视频配音+配乐混音与母带。给出 LUFS/真峰值目标、BGM ducking 的正确做法（含 HyperFrames carve 的负优化陷阱）、无监听设备时用 ffmpeg 客观测量电平层次的方法。
---

# 混音与母带

## 何时用

视频已有旁白和 BGM，需要让**人声清晰、音乐垫底、整体响度合规**。

## 目标值

| 指标               | 目标               | 说明                  |
| ------------------ | ------------------ | --------------------- |
| 整体响度           | **-16 ~ -17 LUFS** | 抖音/B站/YouTube 通用 |
| 真峰值 True Peak   | **≤ -1.5 dBFS**    | 留编码余量            |
| 人声段 vs BGM 空档 | **≥ 15 dB 差**     | 低于 10dB 人声会被盖  |
| LRA                | 8–14 LU            | 过大说明动态失控      |

## 标准处理链

```bash
# 1) 测当前响度
ffmpeg -i in.mp4 -af "ebur128=peak=true" -f null - 2>&1 | grep -E "I:|Peak:"

# 2) 增益 + 限幅（level=false 关键，否则自动电平会把增益吃掉）
ffmpeg -y -i in.mp4 -c:v copy \
  -af "volume=5.4dB,alimiter=limit=0.72:level=false" \
  -c:a aac -b:a 192k -ar 48000 out.mp4

# 3) 复测，反复微调 volume 直到 -16~-17 LUFS
```

`limit=0.72` ≈ -2.8 dBFS；要更响可 `0.8`（-1.9dB），别超过 `0.89`。

## 客观验证电平层次（没有监听设备时）

```bash
# 人声段（取一段有旁白的时间）
ffmpeg -ss 1 -t 2 -i out.mp4 -af volumedetect -f null - 2>&1 | grep mean_volume
# 空档（两句之间）
ffmpeg -ss 4.6 -t 1.2 -i out.mp4 -af volumedetect -f null - 2>&1 | grep mean_volume
```

差值即层次。**实测正常值**：人声 -19 ~ -24 dB，空档 -35 ~ -40 dB。

⚠️ 测量前必须确认那段真的没有旁白——曾把 f2 的开头当成"空档"，得出"BGM 比人声还响"的错误结论。

## BGM ducking：别用 carve

HyperFrames 的 `carve.mjs`（voiceover carve）在**合成音色/配音轨很多**时会过度压床：

- 实测：10 段配音做 carve 后，BGM 空档掉到 **-59 dB**（等同静音），carve 的 level 包络把整条床压死
- 原因：`level` 阶段按"床比人声响多少"推算，多轨人声叠加后判断偏保守

**可靠做法**：固定音量 + 手动标定

```html
<audio
  id="audio-bgm"
  src="assets/bgm.wav"
  data-start="0"
  data-duration="83"
  data-volume="0.2"
></audio>
```

- 配音 `data-volume="2.0"`（SAPI 输出偏轻时）
- BGM `data-volume="0.15~0.25"`（真实音乐素材），合成 pad 可到 0.5
- 换音色/换 BGM 后**必须重新标定**：RVC 输出比 TTS 原声高 5–8 dB

## BGM 素材处理

```bash
# 裁剪到目标时长 + 淡入淡出（避免开头爆音、结尾截断）
ffmpeg -y -ss 20 -t 83 -i no_vocals.wav \
  -af "afade=t=in:st=0:d=2,afade=t=out:st=80:d=3" \
  -ar 44100 -ac 2 bgm.wav
```

## 常见故障

| 现象             | 原因                                  | 修法                                   |
| ---------------- | ------------------------------------- | -------------------------------------- |
| 加增益后反而变轻 | `alimiter` 默认 `level=true` 自动补偿 | 加 `level=false`                       |
| 加压缩后整体下降 | 压缩器阈值太低压掉所有峰值            | 阈值降 6–10dB 或改用纯增益             |
| 峰值 -0.4 dBFS   | 限幅阈值太松                          | `limit=0.72`                           |
| BGM 完全听不见   | carve 过度 duction                    | 移除 `data-fx-chain`/`data-automation` |
| 人声发闷         | BGM 与人声抢占 1–3kHz                 | 降 BGM 音量或给人声 +2dB @3kHz         |

## 交付前检查清单

- [ ] 整体 -16~-17 LUFS，真峰值 ≤ -1.5 dBFS
- [ ] 人声段与空档差 ≥ 15 dB
- [ ] 视频流 `-c:v copy` 未重编码（母带只动音频）
- [ ] 音频 48kHz / AAC 192k（平台上传标准）
