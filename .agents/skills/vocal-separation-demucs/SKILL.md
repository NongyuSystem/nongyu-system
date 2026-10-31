---
name: vocal-separation-demucs
description: 用 demucs 在本地 GPU 分离人声与伴奏（2-stem / 4-stem）。记录 Windows 上绕过 dora 依赖地狱的正确调用方式，以及在线服务（vocalremover.org 等）不可用的原因。
---

# 本地人声分离（demucs）

## 何时用

需要把一首歌变成纯伴奏（BGM）或纯人声（配唱、素材）。

## 为什么不优先用在线服务

- `vocalremover.org`：服务器端处理（`api.vocalremover.org/split/tracks`），**有反代理检测**，代理/VPN 环境直接 403 `Please turn off proxy or VPN`
- 接口虽无鉴权（POST 返回 `invalidFileType` 而非 401），但 `GET /split/get_server` 返回 403，实际不可用
- 结论：算力密集任务，本地 GPU 更快更稳，且不上传隐私

## 安装（Windows + 已有 torch 环境）

复用已有 PyTorch 环境（如 GPT-SoVITS 的 `runtime\python.exe`），**不要** `pip install demucs` 拉全量依赖（会重装 torch）：

```powershell
$py = "E:\...\runtime\python.exe"
$py -m pip install demucs --no-deps -i https://mirrors.aliyun.com/pypi/simple
# 补纯 Python 小依赖：
$py -m pip install julius lameenc openunmix dora-search submitit cloudpickle retrying treetable einops --no-deps -i https://mirrors.aliyun.com/pypi/simple
```

**依赖地狱顺序**（缺一个报一个）：`torchcrepe`（若用 crepe）→ `julius`/`lameenc`/`openunmix` → `dora` → `treetable` → `submitit` → `cloudpickle` → `retrying`。

## 关键：绕过 CLI

`python -m demucs` 会 import `dora.log`（训练用），链接一长串依赖。**直接调推理 API**更省事：

```python
import torch
from demucs.pretrained import get_model
from demucs.apply import apply_model
from demucs.audio import AudioFile, save_audio

device = "cuda" if torch.cuda.is_available() else "cpu"
model = get_model("htdemucs")            # 首次自动下载 ~80MB 到 torch hub
model.to(device).eval()

wav = AudioFile(src).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
ref = wav.mean(0); mean, std = ref.mean(), ref.std()
wav_n = (wav - mean) / std

with torch.no_grad():
    sources = apply_model(model, wav_n[None].to(device), device=device,
                          shifts=1, split=True, overlap=0.25, progress=True)[0]
sources = sources * std + mean

idx = {n: i for i, n in enumerate(model.sources)}   # drums, bass, other, vocals
save_audio(sources[idx["vocals"]].cpu(), "vocals.wav", model.samplerate)
save_audio(sum(sources[i] for n, i in idx.items() if n != "vocals").cpu(),
           "no_vocals.wav", model.samplerate)
```

## 参数

| 参数                 | 作用         | 建议                         |
| -------------------- | ------------ | ---------------------------- |
| `shifts=1`           | 音高抖动增强 | 1 快速；2 更干净但耗时翻倍   |
| `overlap=0.25`       | 分块重叠     | 默认 0.25，够用              |
| `-n htdemucs_ft`     | 微调模型     | 质量更高，慢一些             |
| `--two-stems=vocals` | CLI 两轨模式 | API 里用 `wav - vocals` 等价 |

## 性能参考

RTX 5060 Laptop 8GB：**228 秒音频约 60 秒**分离完成（htdemucs, shifts=1）。

## 验收

```bash
ffmpeg -i vocals.wav -af volumedetect -f null -      # 人声轨应有内容
ffmpeg -i no_vocals.wav -af volumedetect -f null -   # 伴奏轨电平通常高于人声轨
```

两条时长必须与原文件一致（差 < 0.02s）。

## 与后续衔接

分离出的伴奏要做 BGM 时：裁剪到目标时长 → 加淡入淡出 → 见 `audio-mixing-mastering`。
