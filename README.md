# 图片压缩工具

纯前端本地图片压缩工具，无构建、无外部依赖，所有处理在浏览器本地完成，不上传任何文件。

## 运行

Web Worker 需要通过 HTTP 访问，启动任意静态服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 功能

- 本地选择 / 拖拽上传，支持批量（10 张以上）并行处理
- 压缩质量调节（1–100%）、尺寸缩放（预设档位 / 自定义最长边）
- 格式转换：JPEG / PNG / WebP / 保持原格式
- 压缩前后大小对比，单张下载或 ZIP 打包下载
- EXIF 方向自动纠正（优先浏览器内建，失败时手动解析 EXIF 变换）
- 透明通道：PNG / WebP 保留 alpha；转 JPEG 自动铺白底
- 压缩后体积反而变大时，同格式自动回退保留原图
- 50MB+ 超大图：Worker 内解码 + 画布尺寸安全上限保护
- 非图片文件、空文件自动拦截并提示
- IndexedDB 保存处理历史（最近 50 条）

## 技术栈

DOM + Canvas / OffscreenCanvas + File API + Blob + Web Worker（多 Worker 池，主线程不卡）+ IndexedDB。无 OffscreenCanvas 的环境自动降级为主线程 `<img>` + `<canvas>` 处理。

## 文件结构

```
index.html      页面
css/style.css   样式
js/main.js      UI、任务队列、Worker 池、下载、历史
js/worker.js    压缩 / 缩放 / 格式转换 / EXIF 纠正（Worker 内）
js/exif.js      EXIF Orientation 解析与变换矩阵
js/zip.js       极简 ZIP 打包（STORE）
js/db.js        IndexedDB 历史
```
