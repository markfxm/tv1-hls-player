export interface RetryPolicy {
  maxRetry: number;
  retryDelay(attempt: number): number;
}

export function createRetryPolicy(): RetryPolicy {
  return {
    maxRetry: 3,
    retryDelay(attempt: number) {
      return [1000, 3000, 5000][attempt - 1] ?? 5000;
    }
  };
}
