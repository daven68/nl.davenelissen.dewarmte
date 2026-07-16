import { DeWarmteClient } from './client';

export interface LoginResponse {
  access: string;
  refresh: string;
}

interface RefreshResponse {
  access: string;
  refresh?: string;
}

export class AuthService {
  constructor(private client: DeWarmteClient) {}

  async login(email: string, password: string): Promise<void> {
    const result = await this.client.post<LoginResponse>(
      '/auth/token/',
      {
        email,
        password,
      }
    );

    this.client.setTokens(result.access, result.refresh);
  }

  async refreshAccessToken(): Promise<void> {
    const refresh = this.client.getRefreshToken();

    if (!refresh) {
      throw new Error('No DeWarmte refresh token is available');
    }

    const result = await this.client.post<RefreshResponse>(
      '/auth/token/refresh/',
      { refresh }
    );

    this.client.setAccessToken(result.access);

    if (result.refresh) {
      this.client.setRefreshToken(result.refresh);
    }
  }
}
