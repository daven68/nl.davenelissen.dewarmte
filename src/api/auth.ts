import { DeWarmteClient } from './client';

export interface LoginResponse {
  access: string;
  refresh: string;
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

    this.client.setAccessToken(result.access);
  }
}