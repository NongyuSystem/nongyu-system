---
name: bilibili-media-fetch
description: 从 B 站取视频/音频/封面。用官方免费 Web 接口（无需 key）绕过 yt-dlp 的 412 反爬，获取 DASH 音视频直链。也说明第三方解析站（iiilab/SnapAny）的能力边界——签名直链会过期，不能当 API 用。
---

# B 站媒体获取

## 何时用

需要把某条 B 站视频的音频/画面拿来做素材（配乐、二创、剪辑、分析）。

## 免费接口（无 key、无登录）

| 用途       | 接口                                                                            |
| ---------- | ------------------------------------------------------------------------------- |
| 短链解析   | `curl -I https://b23.tv/XXXX` 看 `Location`                                     |
| 视频信息   | `https://api.bilibili.com/x/web-interface/view?bvid=BVxxx`                      |
| 音视频直链 | `https://api.bilibili.com/x/player/playurl?bvid=BVxxx&cid=CID&fnval=16&fourk=0` |

必须带 `Referer: https://www.bilibili.com/` 和浏览器 `User-Agent`。

## 完整流程

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

# 1) 短链 -> BV 号
curl -sI https://b23.tv/XXXX | grep -i location

# 2) 取 cid
curl -s "https://api.bilibili.com/x/web-interface/view?bvid=BVxxx" \
  -H "Referer: https://www.bilibili.com" -H "User-Agent: $UA" | jq '.data.cid'

# 3) 取 DASH 音频直链（fnval=16 必须，否则拿不到 dash）
curl -s "https://api.bilibili.com/x/player/playurl?bvid=BVxxx&cid=CID&fnval=16&fourk=0" \
  -H "Referer: https://www.bilibili.com/video/BVxxx" -H "User-Agent: $UA" \
  | jq -r '.data.dash.audio | sort_by(.bandwidth) | last | .baseUrl'

# 4) 下载（直链同样需要 Referer）
curl -L -o out.m4a "<baseUrl>" \
  -H "Referer: https://www.bilibili.com/video/BVxxx" -H "User-Agent: $UA"

# 5) 转 wav
ffmpeg -y -i out.m4a -ar 44100 -ac 2 out.wav
```

`data.dash.audio` 通常给 3 条码流，按 `bandwidth` 取最大（常见 192k / 132k / 64k）。

## 坑

| 现象                           | 原因                     | 处理                                         |
| ------------------------------ | ------------------------ | -------------------------------------------- |
| `HTTP 412 Precondition Failed` | yt-dlp 直接抓网页被反爬  | **放弃 yt-dlp，改用 playurl 接口**           |
| 直链下载 403                   | 缺 Referer 或链接已过期  | 补 Referer；直链有效期约几分钟，现取现用     |
| 无 `data.dash`                 | 少了 `fnval=16`          | 必须带 `fnval=16`                            |
| 音视频分离                     | B 站 DASH 本就音视频分离 | 需要画面时分别取 `dash.video` 再 ffmpeg 合并 |

## 第三方解析站的能力边界（实测）

`bili.iiilab.com` 已迁移到 `snapany.com/zh/bilibili`：

- ✅ 网页粘贴链接能解析，给 1080p/720p/480p/360p + 封面
- ❌ 下载直链是 **bilivideo.com 带签名的临时地址**（绑 referer + 会话，几分钟过期）
- ❌ curl 直接请求 403，浏览器外无法复用
- ❌ **不能当 API 批量调用**

结论：第三方站适合手动点一次；要脚本化/批量，用上面的官方接口。

## 与后续处理的衔接

- 只要配乐 → 取音频流 → 交给 `vocal-separation-demucs` 去人声
- 需要画面 → 取 `dash.video` 最高码率 + 音频，`ffmpeg -c copy` 合并
- 时长裁剪与淡入淡出在 ffmpeg 里做，别在接口层纠结
