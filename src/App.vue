<template>
  <main class="app-shell">
    <section class="player-panel" aria-label="视频播放器">
      <div class="video-wrap">
        <video ref="videoRef" controls playsinline preload="metadata"></video>
        <button
          v-if="isFullscreen"
          type="button"
          class="exit-fullscreen-button"
          @click="exitFullscreen"
        >
          退出全屏
        </button>
        <div v-if="showEmptyState" class="empty-state">
          <h1>TV1 HLS 播放器</h1>
          <p>选择频道或粘贴 m3u8 地址后点击播放。</p>
        </div>
      </div>
      <div class="status" :class="statusType" role="status">{{ statusMessage }}</div>
    </section>

    <aside class="control-panel" aria-label="播放控制">
      <div class="panel-header">
        <h2>频道</h2>
        <span>{{ visibleChannels.length }} 个频道</span>
      </div>

      <div v-if="categories.length > 1" class="category-tabs" aria-label="频道分类">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          class="category-tab"
          :class="{ active: category === activeCategory }"
          @click="selectCategory(category)"
        >
          {{ category }}
        </button>
      </div>

      <div ref="channelListRef" class="channel-list" @scroll="handleChannelListScroll">
        <div
          v-for="channel in visibleChannels"
          :key="channel.id"
          class="channel-entry"
        >
          <button
            type="button"
            class="node-toggle-button"
            :class="{ active: channel.id === expandedChannelId }"
            :aria-label="`${channel.name} 节点`"
            :aria-expanded="channel.id === expandedChannelId"
            :ref="(el) => setNodeToggleRef(el, channel.id)"
            @click.stop="toggleChannelNodes(channel.id)"
          >
            ‹
          </button>
          <button
            type="button"
            class="channel-item"
            :class="{ active: channel.id === activeChannelId }"
            @click="selectChannel(channel.id, true)"
          >
            {{ channel.name }}
          </button>

          <div
            v-if="channel.id === expandedChannelId"
            class="channel-node-flyout"
            :style="nodeFlyoutStyle"
          >
            <div class="node-flyout-header">
              <strong>{{ channel.name }}</strong>
              <span>{{ getChannelNodes(channel).length }} 个节点</span>
            </div>
            <div class="node-list">
              <button
                v-for="(node, index) in getChannelNodes(channel)"
                :key="`${channel.id}-${index}`"
                type="button"
                class="node-item"
                :class="{
                  active: channel.id === activeChannelId && index === activeNodeIndex,
                  removable: node.userAdded
                }"
                :title="node.url || '未配置地址'"
                @click="selectChannelNode(channel.id, index, true)"
              >
                <span>{{ node.label || `节点${index + 1}` }}</span>
                <span
                  v-if="node.userAdded"
                  class="delete-node-button"
                  title="删除节点"
                  @click.stop="deleteNode(channel.id, index)"
                >
                  ×
                </span>
              </button>
              <button type="button" class="node-item add-node-item" @click="addNode(channel.id)">
                添加节点
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="field">
        <div class="field-heading">
          <span>播放地址</span>
          <button
            type="button"
            class="qr-open-button"
            :disabled="!activeChannel"
            @pointerup.stop.prevent="openQrDialog"
            @click.stop.prevent="openQrDialog"
          >
            扫码填写
          </button>
        </div>
        <textarea
          v-model="streamUrl"
          rows="4"
          spellcheck="false"
          placeholder="在这里粘贴合法可访问的 .m3u8 地址"
          @input="updateActiveNodeUrl"
        ></textarea>
      </div>

      <div class="button-row">
        <button type="button" @click="playCurrentUrl">播放</button>
        <button type="button" class="secondary" @click="stopPlayback()">停止</button>
        <button type="button" class="secondary" @click="requestFullscreen">全屏</button>
      </div>

      <div class="notes">
        <p>现在可通过 <code>npm run dev</code> 启动本地开发服务器。</p>
        <p>如果播放失败，常见原因是地址失效、跨域限制、网络不可达或浏览器禁止自动播放。</p>
      </div>
    </aside>

    <div v-if="qrDialogOpen" class="qr-dialog-backdrop" @click.self="closeQrDialog">
      <section class="qr-dialog" role="dialog" aria-modal="true" aria-label="扫码填写播放地址">
        <div class="qr-dialog-header">
          <h2>手机扫码填写</h2>
          <button type="button" class="qr-close-button" @click="closeQrDialog">×</button>
        </div>
        <div class="qr-dialog-body">
          <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="添加节点二维码">
          <div v-else class="qr-placeholder">正在生成二维码...</div>
          <p>{{ qrStatusMessage }}</p>
          <code v-if="mobileAddUrl">{{ mobileAddUrl }}</code>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import Hls from "hls.js";
import QRCode from "qrcode";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { calculateNodeFlyoutPosition } from "./nodeFlyoutPosition.js";
import { createHlsRecoveryController } from "./player/hlsRecovery.ts";
import { createPlayerLogger } from "./player/playerLogger.ts";
import { LiveBufferManager } from "./player/liveBufferManager.ts";
import { NodeManager, parseStreamNodes } from "./player/nodeManager.ts";

const videoRef = ref(null);
const channelListRef = ref(null);
const channels = ref([]);
const activeChannelId = ref("");
const activeNodeIndex = ref(0);
const streamUrl = ref("");
const statusMessage = ref("正在读取频道配置...");
const statusType = ref("");
const showEmptyState = ref(true);
const isFullscreen = ref(false);
const expandedChannelId = ref("");
const nodeFlyoutStyle = ref({});
const qrDialogOpen = ref(false);
const qrCodeUrl = ref("");
const mobileAddUrl = ref("");
const qrStatusMessage = ref("");
const activeCategory = ref("");

let hls = null;
let hlsRecovery = null;
let liveBufferManager = null;
let nodeManager = null;
let nodeManagerChannelId = "";
let nodeAttemptStartedAt = 0;
let flvPlayer = null;
let flvModule = null;
let playRequestId = 0;
let qrPollTimer = null;
const nodeToggleElements = new Map();
const CUSTOM_NODES_KEY = "tv1-custom-nodes";

const activeChannel = computed(() => {
  return channels.value.find((channel) => channel.id === activeChannelId.value) || channels.value[0] || null;
});

const categories = computed(() => {
  const names = [];
  for (const channel of channels.value) {
    const category = channel.category || "未分类";
    if (!names.includes(category)) {
      names.push(category);
    }
  }
  return names;
});

const visibleChannels = computed(() => {
  if (!activeCategory.value) {
    return channels.value;
  }
  return channels.value.filter((channel) => (channel.category || "未分类") === activeCategory.value);
});

const activeNodes = computed(() => getChannelNodes(activeChannel.value));

const activeNode = computed(() => {
  return activeNodes.value[activeNodeIndex.value] || activeNodes.value[0] || { label: "节点1", url: "" };
});

function setStatus(message, type = "") {
  statusMessage.value = message;
  statusType.value = type;
}

function normalizeUrl(value) {
  return (value || "").trim();
}

function shouldUseStreamProxy(url) {
  return /^https?:\/\//i.test(url)
    && ["localhost", "127.0.0.1", "192.168.1.17"].includes(window.location.hostname);
}

function getPlaybackUrl(url) {
  if (!shouldUseStreamProxy(url)) {
    return url;
  }
  return `/api/stream-proxy?url=${encodeURIComponent(url)}`;
}

function getChannelNodes(channel) {
  if (!channel) {
    return [];
  }
  if (Array.isArray(channel.nodes)) {
    return channel.nodes;
  }
  return [{ label: "节点1", url: channel.url || "" }];
}

function resetNodeManager() {
  nodeManager = null;
  nodeManagerChannelId = "";
}

function ensureNodeManager(channel) {
  if (!channel) {
    return null;
  }
  if (!nodeManager || nodeManagerChannelId !== channel.id) {
    nodeManager = new NodeManager(parseStreamNodes(getChannelNodes(channel)));
    nodeManagerChannelId = channel.id;
  }
  return nodeManager;
}

function getNodeIndex(channel, url) {
  return getChannelNodes(channel).findIndex((node) => normalizeUrl(node.url) === normalizeUrl(url));
}

function loadCustomNodes() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_NODES_KEY) || "{}");
    for (const channel of channels.value) {
      const nodes = saved[channel.id];
      if (!Array.isArray(nodes)) {
        continue;
      }
      if (!Array.isArray(channel.nodes)) {
        channel.nodes = getChannelNodes(channel);
      }
      for (const item of nodes) {
        const url = normalizeUrl(item?.url);
        if (!url) {
          continue;
        }
        channel.nodes.push({
          label: item?.label || `节点${channel.nodes.length + 1}`,
          url,
          userAdded: true
        });
      }
    }
  } catch (error) {
    setStatus(`读取本地自定义节点失败：${error.message}`, "error");
  }
}

function saveCustomNodes() {
  const saved = {};
  for (const channel of channels.value) {
    const customNodes = getChannelNodes(channel)
      .filter((node) => node.userAdded && normalizeUrl(node.url))
      .map((node) => ({
        label: node.label,
        url: normalizeUrl(node.url)
      }));
    if (customNodes.length) {
      saved[channel.id] = customNodes;
    }
  }
  localStorage.setItem(CUSTOM_NODES_KEY, JSON.stringify(saved));
}

function findChannel(channelId) {
  return channels.value.find((channel) => channel.id === channelId) || null;
}

function syncUrlInput() {
  streamUrl.value = activeNode.value.url || "";
}

function destroyHls() {
  hlsRecovery?.destroy();
  hlsRecovery = null;
  liveBufferManager = null;
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

function destroyFlv() {
  if (flvPlayer) {
    flvPlayer.pause();
    flvPlayer.unload();
    flvPlayer.detachMediaElement();
    flvPlayer.destroy();
    flvPlayer = null;
  }
}

function destroyPlaybackEngine() {
  destroyHls();
  destroyFlv();
}

function isFlvUrl(url) {
  return /\.flv(?:[?#]|$)/i.test(url);
}

async function loadFlvModule() {
  if (!flvModule) {
    const module = await import("flv.js");
    flvModule = module.default || module;
  }
  return flvModule;
}

function isInterruptedPlayError(error) {
  const message = error?.message || "";
  return error?.name === "AbortError" || message.includes("interrupted by a call to pause") || message.includes("interrupted by a new load request");
}

function stopPlayback(message = "已停止播放。") {
  const video = videoRef.value;
  playRequestId += 1;
  destroyPlaybackEngine();
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  showEmptyState.value = true;
  setStatus(message);
}

function selectChannel(channelId, autoPlay = false) {
  activeChannelId.value = channelId;
  activeNodeIndex.value = 0;
  resetNodeManager();
  syncUrlInput();

  if (autoPlay) {
    playCurrentUrl();
  }
}

function selectCategory(category) {
  activeCategory.value = category;
  expandedChannelId.value = "";
  nodeFlyoutStyle.value = {};

  if (!visibleChannels.value.some((channel) => channel.id === activeChannelId.value)) {
    const firstChannel = visibleChannels.value[0];
    if (firstChannel) {
      selectChannel(firstChannel.id, false);
    }
  }
}

function selectNode(index, autoPlay = false) {
  activeNodeIndex.value = index;
  syncUrlInput();

  if (autoPlay) {
    playCurrentUrl();
  }
}

function selectChannelNode(channelId, index, autoPlay = false) {
  activeChannelId.value = channelId;
  activeNodeIndex.value = index;
  if (nodeManagerChannelId !== channelId) {
    resetNodeManager();
  }
  syncUrlInput();

  if (autoPlay) {
    playCurrentUrl();
  }
}

function setNodeToggleRef(element, channelId) {
  if (element) {
    nodeToggleElements.set(channelId, element);
  } else {
    nodeToggleElements.delete(channelId);
  }
}

function updateNodeFlyoutPosition(channelId = expandedChannelId.value) {
  const toggle = nodeToggleElements.get(channelId);
  const channelList = channelListRef.value;
  if (!toggle || !channelList) {
    return;
  }

  const style = calculateNodeFlyoutPosition({
    toggleRect: toggle.getBoundingClientRect(),
    listRect: channelList.getBoundingClientRect(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  });

  if (!style) {
    expandedChannelId.value = "";
    nodeFlyoutStyle.value = {};
    return;
  }

  nodeFlyoutStyle.value = style;
}

async function toggleChannelNodes(channelId) {
  if (expandedChannelId.value === channelId) {
    expandedChannelId.value = "";
    nodeFlyoutStyle.value = {};
    return;
  }

  expandedChannelId.value = channelId;
  activeChannelId.value = channelId;
  activeNodeIndex.value = 0;
  syncUrlInput();
  await nextTick();
  updateNodeFlyoutPosition(channelId);
}

function handleChannelListScroll() {
  if (expandedChannelId.value) {
    updateNodeFlyoutPosition();
  }
}

function handleWindowResize() {
  if (expandedChannelId.value) {
    updateNodeFlyoutPosition();
  }
}

function addNode(channelId = activeChannelId.value) {
  const channel = findChannel(channelId);
  if (!channel) {
    return;
  }
  if (!Array.isArray(channel.nodes)) {
    channel.nodes = getChannelNodes(channel);
  }
  channel.nodes.push({
    label: `节点${channel.nodes.length + 1}`,
    url: "",
    userAdded: true
  });
  activeChannelId.value = channel.id;
  activeNodeIndex.value = channel.nodes.length - 1;
  resetNodeManager();
  expandedChannelId.value = "";
  nodeFlyoutStyle.value = {};
  syncUrlInput();
  stopPlayback("已添加空节点。请在播放地址中粘贴 m3u8 链接后点击播放。");
}

function deleteNode(channelId, index) {
  const channel = findChannel(channelId);
  if (!channel || !Array.isArray(channel.nodes) || !channel.nodes[index]?.userAdded) {
    return;
  }

  const wasActive = channel.id === activeChannelId.value && index === activeNodeIndex.value;
  channel.nodes.splice(index, 1);

  if (channel.id === activeChannelId.value) {
    if (activeNodeIndex.value >= channel.nodes.length) {
      activeNodeIndex.value = Math.max(channel.nodes.length - 1, 0);
    } else if (index < activeNodeIndex.value) {
      activeNodeIndex.value -= 1;
    }
    syncUrlInput();
  }

  if (wasActive) {
    stopPlayback("已删除用户添加的节点。");
  } else {
    setStatus("已删除用户添加的节点。");
  }
  resetNodeManager();
  saveCustomNodes();
}

async function playCurrentUrl({ automaticFailover = false } = {}) {
  const video = videoRef.value;
  const channel = activeChannel.value;
  const playbackNodeManager = ensureNodeManager(channel);
  if (!automaticFailover && playbackNodeManager) {
    playbackNodeManager.selectNode(normalizeUrl(streamUrl.value));
  }
  const url = normalizeUrl(streamUrl.value || (automaticFailover ? playbackNodeManager?.getCurrentNode()?.url : ""));
  const playbackUrl = getPlaybackUrl(url);
  const requestId = playRequestId + 1;
  playRequestId = requestId;
  if (!video) {
    return;
  }
  if (!url) {
    stopPlayback("请先在播放地址中配置合法可访问的 m3u8 地址。");
    statusType.value = "error";
    return;
  }

  destroyPlaybackEngine();
  showEmptyState.value = false;
  nodeAttemptStartedAt = Date.now();
  setStatus(`加载中：${activeChannel.value?.name || "未知频道"} ${activeNode.value.label || `节点${activeNodeIndex.value + 1}`}...`);

  try {
    if (isFlvUrl(url)) {
      const flvjs = await loadFlvModule();
      if (!flvjs.isSupported()) {
        throw new Error("Current browser does not support FLV playback.");
      }
      flvPlayer = flvjs.createPlayer({
        type: "flv",
        isLive: true,
        hasAudio: true,
        hasVideo: true,
        url: playbackUrl
      });
      flvPlayer.on(flvjs.Events.ERROR, (_type, detail) => {
        setStatus(`FLV playback failed: ${detail || "unknown error"}`, "error");
        showEmptyState.value = true;
      });
      flvPlayer.attachMediaElement(video);
      flvPlayer.load();
    } else if (Hls.isSupported()) {
      let triedNativeFallback = false;
      const hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
        manifestLoadingTimeOut: 15000,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000
      });
      hls = hlsInstance;
      const playbackBufferManager = new LiveBufferManager(video);
      liveBufferManager = playbackBufferManager;
      const playbackRecovery = createHlsRecoveryController({ logger: createPlayerLogger() });
      hlsRecovery = playbackRecovery;
      hlsInstance.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        playbackBufferManager.setLive(data?.details?.live === true);
      });
      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (requestId !== playRequestId || playbackNodeManager !== nodeManager) {
          return;
        }
        const detail = data?.details || data?.type || "未知错误";
        setStatus(`播放失败：${detail}。可切换其他节点；也可能是地址失效、跨域限制、网络不可达或流格式不兼容。`, "error");
        const recovery = playbackRecovery.handleError(data, {
          startLoad: () => hlsInstance.startLoad(),
          recoverMediaError: () => hlsInstance.recoverMediaError()
        });
        if (recovery?.recovered) {
          setStatus(`播放恢复中（第 ${recovery.attempts || ""} 次重试）...`);
          return;
        }
        if (recovery?.exhausted) {
          playbackNodeManager?.markFailure();
          const nextNode = playbackNodeManager?.getNextNode();
          if (nextNode && nextNode !== NodeManager.FAILED) {
            const nextIndex = getNodeIndex(channel, nextNode.url);
            if (nextIndex !== -1) {
              activeNodeIndex.value = nextIndex;
              syncUrlInput();
              setStatus(`当前节点失败，自动切换至${activeNode.value.label || `节点${nextIndex + 1}`}...`);
              playCurrentUrl({ automaticFailover: true });
              return;
            }
          }
          if (!triedNativeFallback) {
            triedNativeFallback = true;
            destroyHls();
            video.src = playbackUrl;
            video.play().catch(() => {
              showEmptyState.value = true;
            });
            return;
          }
          destroyHls();
          showEmptyState.value = true;
        }
      });
      hlsInstance.loadSource(playbackUrl);
      hlsInstance.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playbackUrl;
    } else {
      throw new Error("当前浏览器不支持 HLS 播放，也无法加载 hls.js。");
    }

    await video.play();
    if (requestId !== playRequestId) {
      return;
    }
    hlsRecovery?.markPlaying();
    setStatus(`播放中：${activeChannel.value?.name || "未知频道"} ${activeNode.value.label || `节点${activeNodeIndex.value + 1}`}。`, "ok");
  } catch (error) {
    if (requestId !== playRequestId || isInterruptedPlayError(error)) {
      return;
    }
    showEmptyState.value = true;
    setStatus(`播放失败：${error.message}`, "error");
  }
}

function requestFullscreen() {
  const target = videoRef.value?.parentElement;
  if (target?.requestFullscreen) {
    target.requestFullscreen();
  }
}

function exitFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  }
}

function handleFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === videoRef.value?.parentElement;
}

function updateActiveNodeUrl() {
  if (activeNodes.value[activeNodeIndex.value]) {
    activeNodes.value[activeNodeIndex.value].url = streamUrl.value;
    resetNodeManager();
    if (activeNodes.value[activeNodeIndex.value].userAdded) {
      saveCustomNodes();
    }
  }
}

async function openQrDialog() {
  if (!activeChannel.value) {
    return;
  }
  clearQrPolling();
  qrDialogOpen.value = true;
  qrCodeUrl.value = "";
  mobileAddUrl.value = "";
  qrStatusMessage.value = "正在创建扫码填写页面...";

  try {
    const response = await fetch("/api/mobile-node-session", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const { token, mobileAddUrl: url } = await response.json();
    mobileAddUrl.value = url;
    qrCodeUrl.value = await QRCode.toDataURL(url, {
      margin: 1,
      width: 256,
      color: {
        dark: "#050608",
        light: "#ffffff"
      }
    });
    qrStatusMessage.value = `扫码后可为 ${activeChannel.value.name} 填写播放地址。`;
    qrPollTimer = window.setInterval(() => pollMobileNode(token), 1500);
  } catch (error) {
    qrStatusMessage.value = `二维码功能需要通过 npm run dev 或 npm run preview 打开：${error.message}`;
  }
}

async function pollMobileNode(token) {
  try {
    const response = await fetch(`/api/mobile-node/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.status !== "submitted") {
      return;
    }
    applyMobileNode(data);
    await fetch(`/api/mobile-node/${encodeURIComponent(token)}`, { method: "DELETE" });
    closeQrDialog();
  } catch (error) {
    qrStatusMessage.value = `等待手机提交时出错：${error.message}`;
  }
}

function applyMobileNode(data) {
  const channel = activeChannel.value;
  if (!channel) {
    return;
  }
  if (!Array.isArray(channel.nodes)) {
    channel.nodes = getChannelNodes(channel);
  }
  const currentNode = channel.nodes[activeNodeIndex.value];
  const targetNode = currentNode?.userAdded && !normalizeUrl(currentNode.url)
    ? currentNode
    : null;
  const node = targetNode || {
    label: data.label || `节点${channel.nodes.length + 1}`,
    url: "",
    userAdded: true
  };
  node.label = data.label || node.label || `节点${channel.nodes.length + 1}`;
  node.url = normalizeUrl(data.url);
  node.userAdded = true;
  if (!targetNode) {
    channel.nodes.push(node);
    activeNodeIndex.value = channel.nodes.length - 1;
  }
  syncUrlInput();
  saveCustomNodes();
  setStatus(`已通过手机保存：${channel.name} ${node.label}`);
}

function clearQrPolling() {
  if (qrPollTimer) {
    window.clearInterval(qrPollTimer);
    qrPollTimer = null;
  }
}

function closeQrDialog() {
  clearQrPolling();
  qrDialogOpen.value = false;
}

function findFirstConfigured() {
  for (const channel of channels.value) {
    const nodes = getChannelNodes(channel);
    const nodeIndex = nodes.findIndex((node) => normalizeUrl(node.url));
    if (nodeIndex !== -1) {
      return { channel, nodeIndex };
    }
  }
  return null;
}

async function loadChannels() {
  try {
    const response = await fetch(`./channels.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("channels.json 必须是数组。");
    }

    channels.value = data;
    loadCustomNodes();
    activeCategory.value = categories.value[0] || "";
    activeChannelId.value = channels.value[0]?.id || "";
    activeNodeIndex.value = 0;
    syncUrlInput();

    const configured = findFirstConfigured();
    if (configured) {
      activeChannelId.value = configured.channel.id;
      activeNodeIndex.value = configured.nodeIndex;
      syncUrlInput();
      await nextTick();
      playCurrentUrl();
    } else {
      setStatus("频道配置已读取。请粘贴或配置 m3u8 地址后点击播放。");
    }
  } catch (error) {
    channels.value = [];
    setStatus(`读取 channels.json 失败：${error.message}`, "error");
  }
}

function handlePlaying() {
  hlsRecovery?.markPlaying();
  nodeManager?.markSuccess(Math.max(Date.now() - nodeAttemptStartedAt, 0));
  setStatus(`播放中：${activeChannel.value?.name || "未知频道"} ${activeNode.value.label || `节点${activeNodeIndex.value + 1}`}。`, "ok");
}

function handleWaiting() {
  setStatus("缓冲中...");
  handleTimeUpdate();
}

function handleTimeUpdate() {
  if (liveBufferManager?.shouldTriggerRecovery()) {
    liveBufferManager.jumpToLive();
  }
}

function handleVideoError() {
  const code = videoRef.value?.error?.code;
  setStatus(`播放失败：媒体错误 ${code || "未知"}。请检查地址、跨域、网络或流格式，或切换其他节点。`, "error");
  showEmptyState.value = true;
}

onMounted(() => {
  const video = videoRef.value;
  video?.addEventListener("playing", handlePlaying);
  video?.addEventListener("waiting", handleWaiting);
  video?.addEventListener("timeupdate", handleTimeUpdate);
  video?.addEventListener("error", handleVideoError);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  window.addEventListener("resize", handleWindowResize);
  loadChannels();
});

onBeforeUnmount(() => {
  const video = videoRef.value;
  video?.removeEventListener("playing", handlePlaying);
  video?.removeEventListener("waiting", handleWaiting);
  video?.removeEventListener("timeupdate", handleTimeUpdate);
  video?.removeEventListener("error", handleVideoError);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  window.removeEventListener("resize", handleWindowResize);
  clearQrPolling();
  destroyHls();
});
</script>
