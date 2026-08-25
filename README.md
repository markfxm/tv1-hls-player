# TV1 HLS 播放器

这是一个 Vue 3 + Vite + JavaScript 的本地 HLS/m3u8 频道验证项目。

## 启动

首次使用先安装依赖：

```powershell
npm install
```

启动开发服务器：

```powershell
npm run dev
```

然后打开：

```text
http://localhost:8080
```

## 配置频道

频道配置在 `public/channels.json`。每个频道支持多个节点：

```json
{
  "id": "cctv1",
  "name": "CCTV-1",
  "nodes": [
    { "label": "节点1", "url": "https://example.com/live/cctv1.m3u8" },
    { "label": "节点2", "url": "https://example.com/live/cctv1-backup.m3u8" }
  ]
}
```

也可以直接在页面播放地址输入框里临时粘贴地址测试。

## 构建

```powershell
npm run build
```
