import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const channelFile = resolve("public/channels.json");
const androidChannelFile = resolve("android", "app", "src", "main", "assets", "channels.json");
const sourceFile = resolve("tests", "fixtures", "cctv.txt");
const cctv6MulticastUrl = "http://202.169.224.202:8800/udp/239.9.1.17:1234";

const channels = JSON.parse(readFileSync(channelFile, "utf8"));
const androidChannels = JSON.parse(readFileSync(androidChannelFile, "utf8"));
const sourceText = readFileSync(sourceFile, "utf8");

assert.deepEqual(androidChannels, channels, "Android asset channels should match public/channels.json");

function parseCctvMainSources(text) {
  const sources = new Map();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const infoLine = lines[index].trim();
    if (!infoLine.startsWith("#EXTINF")) {
      continue;
    }

    const displayName = infoLine.split(",").at(-1)?.trim();
    const match = displayName?.match(/^CCTV-([1-9]|1[0-7])\b/);
    if (!match) {
      continue;
    }

    const url = lines[index + 1]?.trim();
    if (url && !sources.has(`cctv${match[1]}`)) {
      sources.set(`cctv${match[1]}`, url);
    }
  }

  return sources;
}

const expectedSources = parseCctvMainSources(sourceText);

for (let channelNumber = 1; channelNumber <= 17; channelNumber += 1) {
  const id = `cctv${channelNumber}`;
  const channel = channels.find((item) => item.id === id);
  assert.ok(channel, `Missing channel ${id}`);

  const nodes = Array.isArray(channel.nodes) ? channel.nodes : [];
  assert.equal(nodes[0]?.label, "超清", `${id} should put the 超清 node first`);

  const expectedUrl = expectedSources.get(id);
  if (expectedUrl) {
    assert.equal(nodes[0]?.url, expectedUrl, `${id} should put the cctv.txt 超清 URL first`);
  }
}

const cctvChannels = channels.filter((item) => item.category === "央视");
assert.deepEqual(
  cctvChannels.slice(-2).map((item) => ({
    id: item.id,
    name: item.name,
    nodes: item.nodes,
  })),
  [
    {
      id: "cctv4k",
      name: "CCTV-4K (1080p)",
      nodes: [
        {
          label: "高清",
          url: "http://198.204.240.250:82/live/cctv4k.m3u8",
        },
      ],
    },
    {
      id: "cctv8k",
      name: "CCTV-8K (1080p)",
      nodes: [
        {
          label: "高清",
          url: "http://192.151.150.154/live/cctv8k.m3u8",
        },
      ],
    },
  ],
  "CCTV 4K and 8K should be independent channels at the bottom of the CCTV category",
);

const cctv1 = channels.find((item) => item.id === "cctv1");
assert.equal(cctv1?.nodes?.[1]?.label, "超清2", "cctv1 should put the 720p cctv.txt node second");
assert.equal(
  cctv1?.nodes?.[1]?.url,
  "http://74.91.26.218:82/live/cctv1hd.m3u8",
  "cctv1 should include the second cctv.txt source as 超清2",
);

const foreignChannels = channels.filter((item) => item.category === "国外频道");
assert.equal(foreignChannels.length, 7, "Foreign channel imports should leave movie channels in their own category");

const foreignChannelNodes = new Map(foreignChannels.map((item) => [item.name, item.nodes]));
assert.equal(foreignChannelNodes.get("BBC Drama")?.length, 1, "BBC Drama should be one foreign channel");
assert.equal(foreignChannelNodes.get("BBC Earth")?.length, 2, "BBC Earth sources should be grouped as nodes");
assert.equal(foreignChannelNodes.get("BBC News")?.length, 3, "BBC News sources should be grouped as nodes");
assert.equal(foreignChannelNodes.get("NBC News Now")?.length, 5, "NBC News Now sources should be grouped as nodes");

const movieChannels = channels.filter((item) => item.category === "电影频道");
assert.equal(movieChannels.length, 4, "Movie channels should live in their own category");
assert.equal(
  movieChannels.find((item) => item.name === "24 Hour Free Movies")?.nodes?.length,
  2,
  "24 Hour Free Movies should keep its grouped nodes in the movie category",
);
assert.equal(movieChannels.find((item) => item.name === "Charge!")?.nodes?.length, 1, "Charge! should be a movie channel");
assert.equal(
  movieChannels.find((item) => item.name === "Classic Cinema")?.nodes?.length,
  1,
  "Classic Cinema should be a movie channel",
);
assert.equal(
  movieChannels.find((item) => item.name === "Whiplash Cinema")?.nodes?.length,
  1,
  "Whiplash Cinema should be a movie channel",
);

for (const [label, channelSet] of [
  ["public", channels],
  ["Android assets", androidChannels],
]) {
  const cctv6 = channelSet.find((item) => item.id === "cctv6");
  assert.ok(
    cctv6?.nodes?.some((node) => node.label === "组播" && node.url === cctv6MulticastUrl),
    `${label} channels should include the CCTV6 multicast gateway node`,
  );
}
