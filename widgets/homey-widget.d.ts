interface HomeyWidgetApi {
  getDeviceIds(): string[];
  api(method: string, path: string, body: object): Promise<unknown>;
  __(key: string, tokens?: object): string;
  ready(options?: { height?: number }): void;
}

interface Window {
  onHomeyReady(homey: HomeyWidgetApi): void;
}
