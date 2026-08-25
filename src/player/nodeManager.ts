export interface StreamNode {
  url: string;
  priority: number;
}

export interface NodeHealth {
  url: string;
  successCount: number;
  failCount: number;
  lastFailTime: number;
  latency: number;
}

export interface ChannelNodeLike {
  url?: string;
  priority?: number;
}

export function parseStreamNodes(nodes: ChannelNodeLike[] = []): StreamNode[] {
  return nodes
    .map((node, index) => ({
      url: node.url?.trim() || "",
      priority: Number.isFinite(node.priority) ? node.priority : index
    }))
    .filter((node) => node.url);
}

export class NodeManager {
  static readonly FAILED = "FAILED" as const;

  private nodes: StreamNode[];
  private health = new Map<string, NodeHealth>();
  private currentUrl = "";
  private failed = false;

  constructor(nodes: StreamNode[] = []) {
    this.nodes = nodes.filter((node) => node.url);
    this.reset();
  }

  getCurrentNode(): StreamNode | null {
    return this.nodes.find((node) => node.url === this.currentUrl) || null;
  }

  getNextNode(): StreamNode | typeof NodeManager.FAILED {
    const current = this.getCurrentNode();
    const orderedNodes = this.getPriorityOrder();
    const currentIndex = current ? orderedNodes.findIndex((node) => node.url === current.url) : -1;
    const candidates = currentIndex === -1
      ? orderedNodes
      : [...orderedNodes.slice(currentIndex + 1), ...orderedNodes.slice(0, currentIndex)];
    const next = candidates.find((node) => (this.health.get(node.url)?.failCount || 0) === 0);

    if (!next) {
      this.failed = true;
      return NodeManager.FAILED;
    }

    this.currentUrl = next.url;
    this.failed = false;
    return next;
  }

  markSuccess(latency = 0) {
    const current = this.getCurrentNode();
    if (!current) {
      return;
    }
    const health = this.getOrCreateHealth(current.url);
    health.successCount += 1;
    health.latency = Number.isFinite(latency) && latency >= 0 ? latency : 0;
    this.failed = false;
  }

  markFailure() {
    const current = this.getCurrentNode();
    if (!current) {
      return;
    }
    const health = this.getOrCreateHealth(current.url);
    health.failCount += 1;
    health.lastFailTime = Date.now();
  }

  reset(currentUrl = "") {
    this.health.clear();
    this.failed = false;
    this.currentUrl = this.nodes.find((node) => node.url === currentUrl)?.url || this.getPriorityOrder()[0]?.url || "";
    for (const node of this.nodes) {
      this.health.set(node.url, {
        url: node.url,
        successCount: 0,
        failCount: 0,
        lastFailTime: 0,
        latency: 0
      });
    }
  }

  selectNode(urlOrIndex: string | number): StreamNode | null {
    const selected = typeof urlOrIndex === "number"
      ? this.nodes[urlOrIndex]
      : this.nodes.find((node) => node.url === urlOrIndex);
    if (!selected) {
      return null;
    }
    this.currentUrl = selected.url;
    this.failed = false;
    return selected;
  }

  getHealth(url: string): NodeHealth | null {
    const health = this.health.get(url);
    return health ? { ...health } : null;
  }

  private getOrCreateHealth(url: string): NodeHealth {
    const existing = this.health.get(url);
    if (existing) {
      return existing;
    }
    const health = {
      url,
      successCount: 0,
      failCount: 0,
      lastFailTime: 0,
      latency: 0
    };
    this.health.set(url, health);
    return health;
  }

  private getPriorityOrder() {
    return this.nodes
      .map((node, index) => ({ node, index }))
      .sort((left, right) => left.node.priority - right.node.priority || left.index - right.index)
      .map(({ node }) => node);
  }
}
