/* eslint-disable max-classes-per-file */
import { createHash, randomUUID } from 'crypto';

import { AuthService } from './auth';
import { DeWarmteClient } from './client';
import { ProductService } from './products';
import type { HeatCurve } from '../domain/HeatCurve';
import type {
  OperationSettingsResponse,
  Product,
  TopBarStatus,
} from './types';
import { getHttpStatus } from '../util/errors';

/**
 * Shared data is reused for this long, so all devices of one account share
 * a single request per poll interval (30 s) instead of one each.
 */
const SHARED_DATA_TTL_MS = 25 * 1000;

/**
 * Thrown when the stored login is no longer accepted by DeWarmte. The user
 * has to sign in again via Repair.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('DeWarmte session has expired');
    this.name = 'SessionExpiredError';
  }
}

type RefreshTokenListener = (refreshToken: string) => Promise<void> | void;

interface CacheEntry {
  createdAt: number;
  promise: Promise<unknown>;
}

/**
 * One logged-in DeWarmte account session.
 *
 * Devices that were paired with the same login share one session, so:
 * - the refresh token is only refreshed once and every device receives it;
 * - status data is fetched once per poll interval for all devices;
 * - signing in again after a 401 is handled in one place.
 */
export class DeWarmteSession {
  public readonly client: DeWarmteClient;
  private readonly auth: AuthService;
  private readonly products: ProductService;

  private refreshPromise?: Promise<void>;
  private readonly listeners = new Map<string, RefreshTokenListener>();
  private readonly cache = new Map<string, CacheEntry>();

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

  /** All heat pumps of the account (shared between devices). */
  public getProducts(): Promise<Product[]> {
    return this.shared('products', () => this.products.getProducts());
  }

  /** Status bar data of the account (shared between devices). */
  public getTopBarStatus(): Promise<TopBarStatus> {
    return this.shared('top-bar', () => this.products.getTopBarStatus());
  }

  public getOperationSettings(
    productId: string,
  ): Promise<OperationSettingsResponse> {
    return this.request(() => this.products.getOperationSettings(productId));
  }

  public getHeatCurve(productId: string): Promise<HeatCurve> {
    return this.request(() => this.products.getHeatCurve(productId));
  }

  /**
   * Runs an API call with a valid access token. When the access token has
   * expired (401), it is refreshed once and the call is retried. When the
   * refresh token itself is rejected, a SessionExpiredError is thrown.
   */
  public async request<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.client.getAccessToken()) {
      await this.refresh();
    }

    try {
      return await operation();
    } catch (err) {
      if (getHttpStatus(err) !== 401) {
        throw err;
      }

      await this.refresh();
      return operation();
    }
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

    try {
      await this.auth.refreshAccessToken();
    } catch (err) {
      const status = getHttpStatus(err);

      if (status === 400 || status === 401) {
        throw new SessionExpiredError();
      }

      throw err;
    }

    const refreshToken = this.client.getRefreshToken();

    if (!refreshToken || refreshToken === previousRefreshToken) {
      return;
    }

    await Promise.all(
      [...this.listeners.values()].map(async (listener) => listener(refreshToken)),
    );
  }

  /**
   * Returns recent data when another device of this account already fetched
   * it (or is fetching it right now); otherwise fetches it.
   */
  private shared<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key);

    if (entry && Date.now() - entry.createdAt < SHARED_DATA_TTL_MS) {
      return entry.promise as Promise<T>;
    }

    const promise = this.request(load);
    this.cache.set(key, { createdAt: Date.now(), promise });

    // Never keep a failed request: the next device should try again.
    promise.catch(() => {
      if (this.cache.get(key)?.promise === promise) {
        this.cache.delete(key);
      }
    });

    return promise;
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

/** What a device needs from its driver. */
export interface SessionRegistryOwner {
  readonly sessions: DeWarmteSessionRegistry;
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
