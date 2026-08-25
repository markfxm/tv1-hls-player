import { randomUUID } from "node:crypto";
import os from "node:os";
import { Readable } from "node:stream";
import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";
import vue from "@vitejs/plugin-vue";

const pendingNodes = new Map();

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 32) {
        reject(new Error("请求内容过大。"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }
  return "";
}

function getMobileOrigin(req) {
  const hostHeader = req.headers.host || "localhost:8080";
  const [, port = "8080"] = hostHeader.match(/:(\d+)$/) || [];
  const lanAddress = getLanAddress();
  if (lanAddress) {
    return `http://${lanAddress}:${port}`;
  }
  return `http://${hostHeader}`;
}

function addNodeForm(token) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>添加节点</title>
    <style>
      body { margin: 0; padding: 22px; background: #111318; color: #f4f7fb; font-family: Arial, "Microsoft YaHei", sans-serif; }
      main { max-width: 520px; margin: 0 auto; }
      h1 { margin: 0 0 12px; font-size: 26px; }
      p { color: #aeb7c6; line-height: 1.55; }
      label { display: block; margin: 18px 0 8px; color: #aeb7c6; }
      input { box-sizing: border-box; width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid #343b49; border-radius: 6px; background: #1b1f28; color: #fff; font-size: 16px; }
      button { width: 100%; min-height: 50px; margin-top: 20px; border: 0; border-radius: 6px; background: #2f80ed; color: #fff; font-size: 17px; }
    </style>
  </head>
  <body>
    <main>
      <h1>添加播放节点</h1>
      <p>填写后会保存到正在打开的网页版播放器。</p>
      <form method="post" action="/api/mobile-node">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <label>节点名称</label>
        <input name="label" placeholder="例如：节点5">
        <label>m3u8 链接</label>
        <input name="url" required placeholder="https://.../live.m3u8">
        <button type="submit">保存到播放器</button>
      </form>
    </main>
  </body>
</html>`;
}

function successPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已保存</title><style>body{margin:0;padding:28px;background:#111318;color:#f4f7fb;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.6}main{max-width:520px;margin:auto}p{color:#aeb7c6}</style></head><body><main><h1>已保存</h1><p>可以回到网页版播放器查看新节点。</p></main></body></html>`;
}

function errorPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>保存失败</title><style>body{margin:0;padding:28px;background:#111318;color:#f4f7fb;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.6}main{max-width:520px;margin:auto}.error{color:#ff8a8a}</style></head><body><main><h1>保存失败</h1><p class="error">${escapeHtml(message)}</p><p>请回到播放器重新打开二维码。</p></main></body></html>`;
}

function mobileNodeMiddleware() {
  return async (req, res, next) => {
    try {
      const host = req.headers.host || "localhost:8080";
      const url = new URL(req.url || "/", `http://${host}`);

      if (req.method === "POST" && url.pathname === "/api/mobile-node-session") {
        const token = randomUUID();
        pendingNodes.set(token, { createdAt: Date.now(), status: "pending" });
        sendJson(res, 200, {
          token,
          mobileAddUrl: `${getMobileOrigin(req)}/mobile-add?token=${encodeURIComponent(token)}`
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/mobile-add") {
        const token = url.searchParams.get("token");
        if (!token || !pendingNodes.has(token)) {
          sendHtml(res, 404, errorPage("二维码已失效。"));
          return;
        }
        sendHtml(res, 200, addNodeForm(token));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/mobile-node") {
        const form = new URLSearchParams(await readBody(req));
        const token = form.get("token") || "";
        const session = pendingNodes.get(token);
        if (!session) {
          sendHtml(res, 404, errorPage("二维码已失效。"));
          return;
        }
        const urlValue = (form.get("url") || "").trim();
        if (!/^https?:\/\//i.test(urlValue)) {
          sendHtml(res, 400, errorPage("播放链接必须以 http:// 或 https:// 开头。"));
          return;
        }
        pendingNodes.set(token, {
          ...session,
          status: "submitted",
          label: (form.get("label") || "").trim(),
          url: urlValue
        });
        sendHtml(res, 200, successPage());
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/mobile-node/")) {
        const token = decodeURIComponent(url.pathname.slice("/api/mobile-node/".length));
        const session = pendingNodes.get(token);
        if (!session) {
          sendJson(res, 404, { error: "not_found" });
          return;
        }
        sendJson(res, 200, session);
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/mobile-node/")) {
        const token = decodeURIComponent(url.pathname.slice("/api/mobile-node/".length));
        pendingNodes.delete(token);
        sendJson(res, 200, { ok: true });
        return;
      }

      next();
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  };
}

function mobileNodePlugin() {
  const middleware = mobileNodeMiddleware();
  return {
    name: "tv1-mobile-node",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

function proxiedUrl(targetUrl) {
  return `/api/stream-proxy?url=${encodeURIComponent(targetUrl)}`;
}

function rewriteM3u8(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let rewritten = line.replace(/URI="([^"]+)"/g, (_match, uri) => {
        try {
          return `URI="${proxiedUrl(new URL(uri, baseUrl).toString())}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
      const trimmed = rewritten.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return rewritten;
      }
      try {
        rewritten = proxiedUrl(new URL(trimmed, baseUrl).toString());
      } catch {
        rewritten = line;
      }
      return rewritten;
    })
    .join("\n");
}

function isM3u8Response(targetUrl, contentType) {
  return /\.m3u8?(?:[?#]|$)/i.test(targetUrl)
    || /mpegurl|m3u8/i.test(contentType || "");
}

function streamProxyMiddleware() {
  return async (req, res, next) => {
    const host = req.headers.host || "localhost:8080";
    const requestUrl = new URL(req.url || "/", `http://${host}`);
    if (requestUrl.pathname !== "/api/stream-proxy") {
      next();
      return;
    }

    const target = requestUrl.searchParams.get("url") || "";
    if (!/^https?:\/\//i.test(target)) {
      sendJson(res, 400, { error: "invalid_url" });
      return;
    }

    try {
      const headers = {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Accept": req.headers.accept || "*/*"
      };
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(target, {
        headers,
        redirect: "follow"
      });
      const contentType = upstream.headers.get("content-type") || "";

      res.statusCode = upstream.status;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
      res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");

      if (isM3u8Response(upstream.url || target, contentType)) {
        const text = await upstream.text();
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        res.end(rewriteM3u8(text, upstream.url || target));
        return;
      }

      res.setHeader("Content-Type", contentType || "application/octet-stream");
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }
      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        res.end(Buffer.from(await upstream.arrayBuffer()));
      }
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
  };
}

function streamProxyPlugin() {
  const middleware = streamProxyMiddleware();
  return {
    name: "tv1-stream-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    streamProxyPlugin(),
    mobileNodePlugin(),
    vue(),
    legacy({
      targets: ["Android >= 7"],
      modernPolyfills: true
    })
  ]
});
