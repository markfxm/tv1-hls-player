import { createPlayerLogger, type PlayerLogger } from "./playerLogger.ts";
import { createRetryPolicy, type RetryPolicy } from "./retryPolicy.ts";

export const PlayerState = {
  IDLE: "IDLE",
  PLAYING: "PLAYING",
  RECOVERING: "RECOVERING",
  FAILED: "FAILED"
} as const;

export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

export interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
}

export interface HlsRecoveryActions {
  startLoad?: () => void;
  recoverMediaError?: () => void;
  onManifestFailure?: () => void;
}

export interface HlsRecoveryResult {
  handled: boolean;
  recovered: boolean;
  exhausted: boolean;
  attempts: number;
  kind?: "network" | "manifest" | "media" | "buffer";
}

interface HlsRecoveryOptions {
  policy?: RetryPolicy;
  logger?: PlayerLogger;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

const RECOVERABLE_NETWORK_DETAILS = new Set([
  "fragLoadError",
  "manifestLoadError",
  "manifestParsingError",
  "bufferStalledError"
]);

function classifyError(data: HlsErrorData) {
  if (data.details === "bufferStalledError") {
    return "buffer" as const;
  }
  if (data.type === "mediaError") {
    return "media" as const;
  }
  if (data.type === "networkError" || RECOVERABLE_NETWORK_DETAILS.has(data.details || "")) {
    return data.details?.startsWith("manifest") ? ("manifest" as const) : ("network" as const);
  }
  return null;
}

export function createHlsRecoveryController(options: HlsRecoveryOptions = {}) {
  const policy = options.policy || createRetryPolicy();
  const logger = options.logger || createPlayerLogger();
  const schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel || ((timer) => clearTimeout(timer));
  let state: PlayerState = PlayerState.IDLE;
  let attempts = 0;
  let destroyed = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function log(error: string) {
    logger.log({
      state,
      error,
      retry: attempts,
      timestamp: new Date().toISOString()
    });
  }

  function markPlaying() {
    if (destroyed) {
      return;
    }
    state = PlayerState.PLAYING;
    attempts = 0;
    log("-");
  }

  function handleError(data: HlsErrorData, actions: HlsRecoveryActions): HlsRecoveryResult {
    const kind = classifyError(data);
    const baseResult = {
      handled: Boolean(kind),
      recovered: false,
      exhausted: false,
      attempts,
      ...(kind ? { kind } : {})
    };

    if (destroyed || !kind) {
      return baseResult;
    }

    if (attempts >= policy.maxRetry || state === PlayerState.FAILED) {
      state = PlayerState.FAILED;
      if (kind === "manifest") {
        actions.onManifestFailure?.();
      }
      log(data.details || data.type || "unknown");
      return { ...baseResult, exhausted: true, attempts };
    }

    if (pendingTimer !== null) {
      return { ...baseResult, recovered: true };
    }

    attempts += 1;
    state = PlayerState.RECOVERING;
    const delay = policy.retryDelay(attempts);
    const error = data.details || data.type || "unknown";
    log(error);
    pendingTimer = schedule(() => {
      pendingTimer = null;
      if (destroyed || state === PlayerState.FAILED) {
        return;
      }
      if (kind === "media") {
        actions.recoverMediaError?.();
      } else {
        actions.startLoad?.();
      }
    }, delay);

    return {
      ...baseResult,
      recovered: true,
      attempts
    };
  }

  function destroy() {
    if (pendingTimer !== null) {
      cancel(pendingTimer);
      pendingTimer = null;
    }
    destroyed = true;
    state = PlayerState.IDLE;
    attempts = 0;
  }

  return {
    getState: () => state,
    markPlaying,
    handleError,
    destroy
  };
}
