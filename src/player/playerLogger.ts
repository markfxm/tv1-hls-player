export interface PlayerLogEntry {
  state: string;
  error: string;
  retry: number;
  timestamp: string;
}

export interface PlayerLogger {
  log(entry: PlayerLogEntry): void;
}

export function createPlayerLogger(write: (message: string) => void = console.log): PlayerLogger {
  return {
    log(entry) {
      write(
        `[HLS] state: ${entry.state} error: ${entry.error || "-"} retry: ${entry.retry} timestamp: ${entry.timestamp}`
      );
    }
  };
}
