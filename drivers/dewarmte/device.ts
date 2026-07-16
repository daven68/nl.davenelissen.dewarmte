'use strict';

const Homey = require('homey');
const axios: typeof import('axios') = require('axios');

const { DeWarmteClient } = require('../../src/api/client');
const { AuthService } = require('../../src/api/auth');
const { ProductService } = require('../../src/api/products');

class DeWarmteDevice extends Homey.Device {
  private pollTimer?: NodeJS.Timeout;
  private client?: InstanceType<typeof DeWarmteClient>;
  private auth?: InstanceType<typeof AuthService>;
  private products?: InstanceType<typeof ProductService>;

  async onInit() {
    this.log('Device onInit()');

    const refreshToken = this.getStoreValue('refreshToken');

    if (typeof refreshToken !== 'string' || !refreshToken) {
      await this.setUnavailable('DeWarmte-sessie ontbreekt. Koppel het apparaat opnieuw.');
      return;
    }

    this.client = new DeWarmteClient();
    this.client.setRefreshToken(refreshToken);
    this.auth = new AuthService(this.client);
    this.products = new ProductService(this.client);

    try {
      await this.refreshSession();
      await this.poll();
      this.startPolling();
    } catch (err) {
      this.error('Failed to initialize DeWarmte polling', err);
      await this.setUnavailable('Kan geen verbinding maken met DeWarmte.');
    }
  }

  async onDeleted() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.poll().catch(async err => {
        this.error('Failed to poll DeWarmte product status', err);
        await this.setUnavailable('Kan geen verbinding maken met DeWarmte.');
      });
    }, 30 * 1000);

    this.log('Polling timer started');
  }

  private async poll(): Promise<void> {
    try {
      await this.updateCapabilities();
    } catch (err) {
      if (!axios.isAxiosError(err) || err.response?.status !== 401) {
        throw err;
      }

      await this.refreshSession();
      await this.updateCapabilities();
    }

    await this.setAvailable();
  }

  private async refreshSession(): Promise<void> {
    if (!this.client || !this.auth) {
      throw new Error('DeWarmte client has not been initialized');
    }

    const previousRefreshToken = this.client.getRefreshToken();

    await this.auth.refreshAccessToken();

    const refreshToken = this.client.getRefreshToken();

    if (refreshToken && refreshToken !== previousRefreshToken) {
      await this.setStoreValue('refreshToken', refreshToken);
    }
  }

  private async updateCapabilities(): Promise<void> {
    this.log('refreshDevice() called');

    if (!this.products) {
      throw new Error('DeWarmte product service has not been initialized');
    }

    const productId = this.getSetting('productId');

    if (typeof productId !== 'string' || !productId) {
      throw new Error('DeWarmte productId setting is missing');
    }

    const products = await this.products.getProducts();
    const product = products.find((item: { id: string }) => item.id === productId);

    if (!product) {
      throw new Error(`DeWarmte product ${productId} was not found`);
    }

    this.log(`Product received: ${product.id}`);

    this.log(
      `Status updated: actual=${product.status.actual_temperature}, ` +
      `target=${product.status.target_temperature}, ` +
      `fault=${product.status.fault_code}`
    );

    await Promise.all([
      this.setCapabilityValue('measure_temperature', product.status.actual_temperature),
      this.setCapabilityValue('target_temperature', product.status.target_temperature),
      this.setCapabilityValue('alarm_generic', product.status.fault_code !== 0),
    ]);

    this.log('Capabilities updated');
  }

}

module.exports = DeWarmteDevice;
