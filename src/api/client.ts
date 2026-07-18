import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';

export class DeWarmteClient {
  private client: AxiosInstance;
  private accessToken?: string;
  private refreshToken?: string;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.mydewarmte.com/v1',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  public setAccessToken(token: string): void {
    this.accessToken = token;
    this.client.defaults.headers.common.Authorization = `Bearer ${token}`;
  }

  public setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  public setTokens(accessToken: string, refreshToken: string): void {
    this.setAccessToken(accessToken);
    this.setRefreshToken(refreshToken);
  }

  public getAccessToken(): string | undefined {
    return this.accessToken;
  }

  public getRefreshToken(): string | undefined {
    return this.refreshToken;
  }

  public async get<T>(url: string): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url);
    return response.data;
  }

  public async post<T>(
    url: string,
    body: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(
      url,
      body,
      config,
    );

    return response.data;
  }
}
