import axios from 'axios';

/**
 * Short, privacy-safe description of an error for the logs: never includes
 * URLs, tokens, e-mail addresses or response bodies.
 */
export function getSafeErrorSummary(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 'unknown';
    const code = typeof error.code === 'string'
      ? error.code.replace(/[^A-Z0-9_-]/gi, '').slice(0, 40)
      : 'unknown';

    return `API error (status=${status}, code=${code || 'unknown'})`;
  }

  if (error instanceof Error) {
    const errorName = error.name.replace(/[^A-Z0-9_-]/gi, '').slice(0, 40);
    return `${errorName || 'Error'} occurred`;
  }

  return 'Unknown error occurred';
}

export function getHttpStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}
