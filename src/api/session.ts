/* eslint-disable max-classes-per-file */
import { createHash, randomUUID } from 'crypto';

import { AuthService } from './auth';
import { DeWarmteClient } from './client';
import { ProductService } from './products';

type RefreshTokenListener = (refreshToken: string) => Promise<void> | void;

/**
 * One logged-in DeWarmte account session.
 *
 * Devices that were paired with the same login share one session, so the
 * refresh token is only refreshed once and every device receives the new
 * token. This prevents one device from invalidating the token of another.
 */
export class DeWarmteSession {
  public readonly client: DeWarmteClient;
  public readonly auth: AuthService;
  public readonly products: ProductService;

  private refreshPromise?: Promise<void>;
  private readonly listeners = new Map<string, RefreshTokenListener>();

  constructor(refreshToken: string) {
    this.client = new DeWarmteClient();
    this.client.setRefreshToken(refreshToken);
    this.auth = new AuthService(this.client);
    this.products = new ProductService(this.client);
  }

  public addListener(deviceId: string, listener: RefreshTokenListener): void {
    this.listeners.set(deviceId, listener);
  }

  public removeListener(deviceId: string): void {
    this.listeners.delete(deviceId);
  }

  public get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Refreshes the access token. Concurrent calls share one request.
   */
  public refresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = undefined;
      });
    }

    return this.refreshPromise;
  }

  private async performRefresh(): Promise<void> {
    const previousRefreshToken = this.client.getRefreshToken();

    await this.auth.refreshAccessToken();

    const refreshToken = this.client.getRefreshToken();

    if (!refreshToken || refreshToken === previousRefreshToken) {
      return;
    }

    await Promise.all(
      [...this.listeners.values()].map(async (listener) => listener(refreshToken)),
    );
  }
}

/**
 * Keeps one session per DeWarmte login.
 */
export class DeWarmteSessionRegistry {
  private readonly sessions = new Map<string, DeWarmteSession>();

  public get(sessionKey: string, refreshToken: string): DeWarmteSession {
    let session = this.sessions.get(sessionKey);

    if (!session) {
      session = new DeWarmteSession(refreshToken);
      this.sessions.set(sessionKey, session);
    }

    return session;
  }

  public release(sessionKey: string, deviceId: string): void {
    const session = this.sessions.get(sessionKey);

    if (!session) {
      return;
    }

    session.removeListener(deviceId);

    if (session.listenerCount === 0) {
      this.sessions.delete(sessionKey);
    }
  }
}

export function createSessionKey(): string {
  return randomUUID();
}

/**
 * Session key for devices paired before session keys existed. Devices that
 * were paired together share the same refresh token, and therefore the same
 * derived key.
 */
export function deriveSessionKey(refreshToken: string): string {
  return `legacy-${createHash('sha256').update(refreshToken).digest('hex').slice(0, 16)}`;
}
