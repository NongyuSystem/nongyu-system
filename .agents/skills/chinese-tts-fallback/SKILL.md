---
name: chinese-tts-fallback
description: 中文语音合成的多级降级方案。当 edge-tts 因网络/区域被拒（403）、PyPI 装不上包时，逐级退到本地 SAPI（Microsoft Huihui/Yaoyao/Kangkang），并记录 WinRT 异步在 PowerShell 下的失效点。适用于"给视频配音""批量生成旁白"。
---

# 中文 TTS 降级链

## 何时用

需要把文字稿变成中文语音（视频旁白、播报、批量音频）。

## 降级顺序（从好到保底）

```
1. edge-tts（微软神经语音，最自然）    → 网络/区域限制时失败
2. Windows OneCore 语音（Yaoyao/Kangkang）→ WinRT 异步在 PS 下常失效
3. Windows SAPI（Huihui Desktop）      → ★ 最稳，一定有
4. GPT-SoVITS 本地模型                 → 音色固定，需已有权重
```

## 第 1 级：edge-tts

```bash
pip install edge-tts -i https://mirrors.aliyun.com/pypi/simple
edge-tts --voice zh-CN-YunxiNeural --text "文案" --write-media out.mp3
```

**失败模式**（实测）：

- `pip` 主源/清华源**全部超时** → 换 `https://mirrors.aliyun.com/pypi/simple` 或腾讯云镜像
- WebSocket 直连返回 **403**（区域封锁），即使 `speech.platform.bing.com` 的 voices 接口能 200
- 自建 WebSocket 客户端需 `Sec-MS-GEC` 签名（Windows 文件时间对齐 300s + token 的 SHA256），补了签名仍可能 403

**结论**：国内网络别在这条路上耗时间，直接降级。

## 第 2 级：WinRT SpeechSynthesizer（常失效）

```powershell
# 列可用语音（这个能成功）
[Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | % { "$($_.DisplayName) | $($_.Language)" }
```

**坑**：`SynthesizeTextToStreamAsync` 在 PowerShell 里返回 **null**（WinRT 异步投影失败），
`[System.WindowsRuntimeSystemExtensions]::GetMethods()` 有时也返回 null，`MakeGenericMethod` 直接崩。
只有 OCR 那套 `[Windows.Media.Ocr]` 的反射写法能稳定工作，语音合成不行。

→ 可用语音列表拿到了，但合成要用下一级。

## 第 3 级：SAPI（推荐保底）

```powershell
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Huihui Desktop")   # 或 Yaoyao / Kangkang
$synth.Rate = 1                                   # -10..10，1 略快
$synth.Volume = 100
$synth.SetOutputToWaveFile("out.wav")
$synth.Speak("文案")
$synth.SetOutputToNull()
$synth.Dispose()
```

- 输出 22050Hz 单声道 WAV，时长准确
- 质量偏机械，但**零网络依赖、零失败率**
- 中文语音必有三个：`Microsoft Huihui Desktop`(女) / `Yaoyao`(女) / `Kangkang`(男)

## 批量配音脚本要点

```powershell
# 声音列表 -> JSON 文案 -> 逐条合成
$lines = Get-Content "vo-lines.json" -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($l in $lines) {
  $synth.SetOutputToWaveFile("assets/vo/$($l.id).wav")
  $synth.Speak($l.text)
  $synth.SetOutputToNull()
}
```

**注意**：`SetOutputToWaveFile` 后必须 `SetOutputToNull()`，否则下一条会追加/阻塞。

## 时长与画面匹配

中文语速约 **4–5 字/秒**（SAPI Rate=1）。写文案时按目标窗口反推字数：

```
目标 6 秒 → 文案 ≤ 28 字；目标 10 秒 → ≤ 45 字
```

生成后必须核对：`ffprobe -show_entries format=duration`，超出窗口就缩句或提速。

## 想更好听？

- 拿到可用网络后换回 edge-tts（`zh-CN-YunxiNeural` 男声 / `XiaoxiaoNeural` 女声）
- 或用 `rvc-voice-conversion` 把 SAPI 输出转成目标音色（这一步能显著改善质感）
