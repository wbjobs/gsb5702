# 图片压缩工具

纯前端图片压缩 / 格式转换工具：零依赖、零上传，所有处理在本地浏览器完成。

## 运行

Web Worker 要求通过 HTTP 访问（不能直接双击 html），启动任意静态服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 功能

- **本地选择 / 拖拽上传**：点击或拖拽（支持批量 10 张以上），非图片文件直接标记失败
- **压缩质量调整**：10%–100% 滑块（PNG 为无损格式，浏览器会忽略质量参数）
- **尺寸缩放**：75% / 50% / 25% 比例缩放 + 最长边像素限制
- **格式转换**：JPEG / PNG / WebP / 保持原格式；GIF、BMP 等其它格式统一转 PNG
- **大小对比**：每张图展示压缩前后体积与变化百分比，顶部汇总总节省空间
- **下载**：单张下载，或一键打包 ZIP（自实现 STORE 模式打包器，无第三方依赖）
- **处理历史**：IndexedDB 持久化最近 100 条记录（含缩略图）

## 边界情况处理

| 场景 | 处理方式 |
| --- | --- |
| 50MB+ 超大图片 | 全程 Blob/createImageBitmap 流式解码，不转 DataURL；处理在 Worker 中进行 |
| 非图片文件 | MIME + 扩展名双重校验，列表中标记失败，不阻塞其它任务 |
| EXIF 方向 | `createImageBitmap(..., {imageOrientation: 'from-image'})` 解码时自动旋转纠正 |
| 透明通道 | PNG/WebP 输出保留 alpha；转 JPEG 时自动铺白底（避免透明区域变黑） |
| 压缩后反而变大 | 同格式时自动保留原图并提示；格式转换场景保留结果但标记「体积增大」 |
| 主线程卡顿 | 解码/缩放/编码全部在 Web Worker 池（最多 4 个）中并行执行 |

## 技术栈

DOM + Canvas（OffscreenCanvas）+ File API + Blob + Web Worker + IndexedDB，无构建步骤、无第三方库。

```
index.html      页面结构
css/style.css   样式
js/main.js      主线程：UI、Worker 池调度、下载、历史
js/worker.js    Worker：解码（EXIF 纠正）→ 缩放 → 编码
js/zip.js       极简 ZIP 打包器（STORE 模式 + CRC32）
js/db.js        IndexedDB 历史记录封装
```

## 测试

```bash
python3 test/run.py            # 自动查找 Chrome/Chromium，跑全部 E2E 用例
python3 test/run.py /path/to/chrome
```

E2E 覆盖：JPEG 压缩、PNG/WebP 透明通道、JPEG 铺白底、EXIF 方向纠正、
50MB 大文件、非图片文件、批量 12 张 < 10 秒、压缩后变大逻辑、ZIP 打包、IndexedDB。
