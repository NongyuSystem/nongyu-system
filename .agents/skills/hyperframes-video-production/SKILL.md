---
name: hyperframes-video-production
description: 用 HyperFrames（HTML 驱动视频）制作竖屏/横屏宣传片。涵盖项目初始化、子组合拆分、GSAP 动效编排、lint 修复、本机 Chrome 绕开下载、渲染与母带。适用于"用代码做视频""HTML 生成视频""炫酷转场动效"等需求。
---

# HyperFrames 视频制作

把视频当网页写：每个场景是 HTML，动效用 GSAP 时间轴，渲染器逐帧截图合成 MP4。

## 何时用

- 需要**精确排版**的品牌片、功能介绍、数据动画（AI 生图做不到准确中文与 UI）
- 需要**可迭代**的视频（改文案/改布局重渲染即可，不用剪映）
- 需要**动效**：卡片级联、数字滚动、3D 翻转、光晕、粒子

## 项目初始化

```bash
npx --yes hyperframes@latest skills update general-video   # 装 workflow skill
npx --yes hyperframes@latest init                          # 生成 my-video/
```

项目结构（**关键**：根组合只能由子组合构成，否则 lint 报 `nested_structure_needs_subcomposition`）：

```
my-video/
├── index.html                 # 纯宿主：每个场景一个挂载槽
├── compositions/frames/       # 每个场景一个 HTML（含 <template>）
├── assets/                    # 视频/音频/图片
├── boards/stills/             # 审阅用静帧
└── hyperframes.json
```

## 宿主 index.html 骨架

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-width="1080"
  data-height="1920"
  data-duration="83"
>
  <div
    id="f1"
    class="clip"
    data-composition-id="f1"
    data-composition-src="compositions/frames/01-hook.html"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    data-width="1080"
    data-height="1920"
  ></div>
  <!-- 后续场景依次排列 -->
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  window.__timelines["main"] = tl;
</script>
```

## 子组合文件骨架

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template>
      <style>
        #root {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
      </style>
      <div id="root" data-composition-id="f1" data-width="1080" data-height="1920">
        <!-- 场景内容 -->
      </div>
      <script>
        const tl = gsap.timeline({ paused: true });
        const EASE = "power3.out";
        tl.to({}, { duration: 6 }); // 占位：覆盖整帧窗口
        tl.fromTo(
          "#hero",
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.7, ease: EASE },
          0.2,
        );
        window.__timelines["f1"] = tl; // key 必须等于 composition-id
      </script>
    </template>
  </body>
</html>
```

**三条铁律**：

1. `<style>`/`<script>` 必须放在 `<template>` **内部**（head 会被丢弃）
2. 时间轴用**局部时间**（0 起），宿主 `data-start` 负责全局定位
3. 宿主 id、内部 `data-composition-id`、`window.__timelines` key 三者一致

## 动效配方（GSAP）

| 效果     | 写法                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 弹入     | `fromTo(el, {scale:0,opacity:0}, {scale:1,opacity:1,duration:.55,ease:"power3.out"})`                                      |
| 级联     | `items.forEach((el,i)=> tl.fromTo(el, {...}, {...}, base + i*0.075))`                                                      |
| 3D 翻转  | `fromTo(el,{rotationX:22,y:130,opacity:0},{rotationX:0,y:0,opacity:1,duration:1,ease:"expo.out"})`                         |
| 数字滚动 | `const p={v:0}; tl.to(p,{v:target,duration:.85,onUpdate(){el.textContent=Math.round(p.v)}},t)`                             |
| 呼吸脉冲 | `tl.to(el,{scale:1.06,duration:.9,ease:"sine.inOut",yoyo:true,repeat:5},t)`                                                |
| 模糊砸入 | `fromTo(el,{scale:1.5,opacity:0,filter:"blur(24px)"},{scale:1,opacity:1,filter:"blur(0px)",duration:1,ease:"power4.out"})` |

**禁止**：对 `.clip` 做 `autoAlpha`/`visibility`；tween `width/height/top/left`；`Math.random()`/`Date.now()`。

## lint 常见报错与修法

| 报错                                    | 原因                               | 修法                                                             |
| --------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `nested_structure_needs_subcomposition` | 根组合里直接写内容                 | 拆到 `compositions/frames/*.html` 用 `data-composition-src` 挂载 |
| `media_missing_data_start`              | `<video>` 无计时                   | 给 video 加 `data-start`/`data-duration`                         |
| `video_nested_in_timed_element`         | video 嵌在带 `data-start` 的容器里 | 让 video 自己当根级 clip，或容器不带 `data-start`                |
| `font_family_without_font_face`         | 用了系统字体名                     | 加 `@font-face { font-family:"X"; src:local("X"); }`             |
| `gsap_css_transform_conflict`           | CSS 初始 transform + GSAP 同属性   | 初始态写进 `fromTo` 的 from，不用 CSS transform                  |

## 渲染

```bash
# 本机已有 Chrome 时，跳过 chrome-headless-shell 下载（国内网络关键）
$env:HYPERFRAMES_BROWSER_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npx hyperframes render --fps 30 --workers 4
```

83 秒 / 1080×1920 / 30fps ≈ **80 秒**渲染完（4 workers + 硬件 GPU）。

**下载卡死处理**：`~/.cache/hyperframes/.chrome.install.lock` 是 **目录锁**，进程被杀后会残留死锁：

```bash
rm -rf "$HOME/.cache/hyperframes/.chrome.install.lock" "$HOME"/.cache/hyperframes/.chrome-staging-*
```

## 渲染器警告

`Video "xxx" has sparse keyframes` → 逐帧 seek 会冻结，重编码：

```bash
ffmpeg -i in.mp4 -c:v libx264 -r 30 -g 30 -keyint_min 30 -movflags +faststart -c:a copy out.mp4
```

## 验收

- `npx hyperframes lint` → 0 errors（warnings 可接受）
- 抽帧核对：`ffmpeg -ss <t> -i out.mp4 -frames:v 1 check.png`
- 无视觉模型时，用 PIL 扫像素确认字幕条/元素确实渲染（见 `audio-mixing-mastering` 的验证思路）
