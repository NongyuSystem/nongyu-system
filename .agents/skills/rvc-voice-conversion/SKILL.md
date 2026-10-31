---
name: rvc-voice-conversion
description: 用 RVC（Retrieval-based Voice Conversion）把任意 TTS 语音转成指定角色音色（初音未来等）。涵盖模型来源（hf-mirror）、PyTorch 2.6+ 的 weights_only 补丁、rvc_python 写文件 bug 的绕过、f0 音高调节。
---

# RVC 音色转换

## 何时用

- 已有 TTS/真人朗读，想换成某个**角色音色**（初音未来、动漫角色、特定歌手）
- 官方 Vocaloid/Piapro 无免费 API，RVC 是唯一免费可脚本化的路径

## 模型来源（国内网络）

`huggingface.co` 与 `github.com` 直连不通，用 **hf-mirror.com**：

```bash
# 搜索
curl -s "https://hf-mirror.com/api/models?search=hatsune%20miku" | jq -r '.[].modelId'

# 常用仓库（实测可用）
# HidekoHaruna/RVC_V2_Hatsune_Miku  → weights/MikuAI_e210_s6300.pth + .index
# aple/HatsuneMikuRVC               → miku_default/mellow/power 三个风格 zip

BASE="https://hf-mirror.com/HidekoHaruna/RVC_V2_Hatsune_Miku/resolve/main"
curl -L -o miku.pth   "$BASE/weights/MikuAI_e210_s6300.pth"
curl -L -o miku.index "$BASE/weights/added_IVF1811_Flat_nprobe_1_MikuAI_v2.index"
```

hubert/rmvpe 特征模型会在首次推理时自动下载，务必先设：

```bash
export HF_ENDPOINT=https://hf-mirror.com
```

## 安装

复用已有 torch 环境（GPT-SoVITS runtime 通常已带 torch/torchaudio/fairseq/faiss/pyworld/soundfile/parselmouth）：

```powershell
$py -m pip install rvc-python --no-deps -i https://mirrors.aliyun.com/pypi/simple
$py -m pip install torchcrepe -i https://mirrors.aliyun.com/pypi/simple   # 唯一常缺的
```

`faiss-cpu`/`omegaconf` 版本不符只是警告，不影响推理。

## 两个必踩的坑

### 坑 1：PyTorch 2.6+ 的 `weights_only=True`

fairseq 加载 hubert 会抛 `_pickle.UnpicklingError: Weights only load failed`。加载 rvc 前打补丁：

```python
import torch
_orig = torch.load
def _compat(*a, **kw):
    kw.setdefault("weights_only", False)
    return _orig(*a, **kw)
torch.load = _compat
```

### 坑 2：`rvc_python.infer_file` 写文件崩

`wavfile.write(path, sr, wav_opt)` 里 `wav_opt` 是 **tuple**，报 `'tuple' object has no attribute 'dtype'`。绕过——直接调底层 `vc_single`：

```python
from rvc_python.infer import RVCInference
rvc = RVCInference(device="cuda:0")
rvc.load_model(PTH, index_path=INDEX)          # index 可省略
rvc.set_params(f0up_key=3, f0method="rmvpe", index_rate=0.75,
               filter_radius=3, resample_sr=0, rms_mix_rate=0.25, protect=0.33)

file_index = rvc.models[rvc.current_model].get("index", "")
res = rvc.vc.vc_single(sid=0, input_audio_path=src, f0_up_key=3, f0_method="rmvpe",
                       file_index=file_index, index_rate=0.75, filter_radius=3,
                       resample_sr=0, rms_mix_rate=0.25, protect=0.33,
                       f0_file="", file_index2="")
audio = res[0] if isinstance(res, tuple) else res      # ← 关键兼容
audio = np.asarray(audio, dtype=np.float32).flatten()
peak = float(np.abs(audio).max() or 1.0)
if peak > 0.98: audio = audio / peak * 0.98             # 防削波
sf.write(dst, audio, rvc.vc.tgt_sr)                     # 40000Hz
```

注意 `infer_file` 只接受 `(input_path, output_path)`，参数必须走 `set_params`。

## 参数速查

| 参数           | 含义     | 建议                                    |
| -------------- | -------- | --------------------------------------- |
| `f0up_key`     | 音高半音 | 男→女 +12；女→女 +3~+5（角色音更高）    |
| `f0method`     | 音高提取 | `rmvpe`（最准，推荐）/ `harvest` / `pm` |
| `index_rate`   | 索引混合 | 0.5–0.75，越高越像但可能失真            |
| `protect`      | 辅音保护 | 0.33 默认；破音时提到 0.5               |
| `rms_mix_rate` | 响度混合 | 0.25 保留原动态；想更响用 0             |

## 性能与验证

RTX 5060：10 段（共 ~50 秒语音）转换 **约 5 秒**。

无法试听时的客观验证：比较转换前后的**高频能量**（初音等角色音更亮）：

```bash
ffmpeg -i voice.wav -af "highpass=f=4000,volumedetect" -f null -   # 看 mean_volume
# 实测：Huihui -42.1dB → 初音版 -32.2dB，提升 10dB 即音色已明显变化
```

时长应与原文件一致（差 < 0.05s），否则检查 `resample_sr`。

## 输出电平

RVC 输出通常比 TTS 原声**高 5–8 dB**，后续混音必须重新标定（见 `audio-mixing-mastering`）。
