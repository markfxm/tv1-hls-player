interface SeekableRange {
  length: number;
  end(index: number): number;
}

interface LiveVideoElement {
  currentTime: number;
  seekable: SeekableRange;
}

export interface LiveBufferManagerOptions {
  isLive?: boolean;
  maxLatency?: number;
}

export interface LiveBufferManager {
  getLatency(): number;
  isBehindLiveEdge(): boolean;
  jumpToLive(): void;
  shouldTriggerRecovery(): boolean;
}

export class LiveBufferManager implements LiveBufferManager {
  private readonly video: LiveVideoElement;
  private readonly maxLatency: number;
  private live: boolean;

  constructor(video: LiveVideoElement, options: LiveBufferManagerOptions = {}) {
    this.video = video;
    this.live = options.isLive === true;
    this.maxLatency = options.maxLatency ?? 90;
  }

  getLatency(): number {
    const seekable = this.video?.seekable;
    if (!seekable || seekable.length === 0) {
      return 0;
    }

    const liveEdge = seekable.end(seekable.length - 1);
    if (!Number.isFinite(liveEdge) || !Number.isFinite(this.video.currentTime)) {
      return 0;
    }
    return Math.max(0, liveEdge - this.video.currentTime);
  }

  isBehindLiveEdge(): boolean {
    return this.live && this.getLatency() > this.maxLatency;
  }

  jumpToLive(): void {
    if (!this.live || !this.video?.seekable || this.video.seekable.length === 0) {
      return;
    }

    const liveEdge = this.video.seekable.end(this.video.seekable.length - 1);
    if (Number.isFinite(liveEdge)) {
      this.video.currentTime = liveEdge;
    }
  }

  shouldTriggerRecovery(): boolean {
    return this.isBehindLiveEdge();
  }

  setLive(isLive: boolean): void {
    this.live = isLive;
  }
}
