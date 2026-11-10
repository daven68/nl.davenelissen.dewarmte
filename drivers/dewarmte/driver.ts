'use strict';

import type { Product } from '../../src/api/types';

const Homey = require('homey');
const axios: typeof import('axios') = require('axios');

type PairSession = import('homey/lib/PairSession');

const { DeWarmteClient } = require('../../src/api/client');
const { AuthService } = require('../../src/api/auth');
const { ProductService } = require('../../src/api/products');

interface LoginData {
  email: string;
  password: string;
}

interface TargetSupplyTemperatureConditionArgs {
  device: InstanceType<typeof Homey.Device>;
  temperature: number;
}

function getSafeErrorSummary(error: unknown): string {
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

export = class DeWarmteDriver extends Homey.Driver {

  async onInit() {
    this.log('DeWarmte Driver initialized');

    this.homey.flow
      .getConditionCard('pump_is_on')
      .registerRunListener(({ device }: { device: InstanceType<typeof Homey.Device> }) => {
        return device.getCapabilityValue('pump_active') === true;
      });

    this.homey.flow
      .getConditionCard('target_supply_temperature_above')
      .registerRunListener(({
        device,
        temperature,
      }: TargetSupplyTemperatureConditionArgs) => {
        const targetTemperature = device.getCapabilityValue(
          'measure_target_temperature',
        );

        return typeof targetTemperature === 'number'
          && targetTemperature > temperature;
      });

    this.homey.flow
      .getConditionCard('gas_boiler_is_active')
      .registerRunListener(({ device }: { device: InstanceType<typeof Homey.Device> }) => {
        return device.getCapabilityValue('gas_boiler_active') === true;
      });

    this.homey.flow
      .getConditionCard('thermostat_is_active')
      .registerRunListener(({ device }: { device: InstanceType<typeof Homey.Device> }) => {
        return device.getCapabilityValue('thermostat_active') === true;
      });
  }

  async onPair(session: PairSession) {

    this.log('=== Pair session started ===');

    const client = new DeWarmteClient();
    const auth = new AuthService(client);
    const products = new ProductService(client);

    session.setHandler('login', async ({ email, password }: LoginData) => {

      this.log('Login attempt');

      try {

        await auth.login(email, password);

        this.log('✅ Login successful');

        return true;

      } catch (err) {

        this.error(`Login failed: ${getSafeErrorSummary(err)}`);

        throw new Error(this.homey.__('pair.login.error'));

      }

    });

    session.setHandler('list_devices', async () => {

      this.log('Listing products...');

      try {

        const productList = await products.getProducts();
        const refreshToken = client.getRefreshToken();

        if (!refreshToken) {
          throw new Error('DeWarmte refresh token is missing');
        }

        this.log(`Found ${productList.length} products`);

        return productList.map((product: Product) => ({

          name: product.nickname || product.name,

          data: {
            id: product.id,
          },

          settings: {
            productId: product.id,
            model: product.type,
          },

          store: {
            refreshToken,
          },

        }));

      } catch (err) {

        this.error(`Failed to retrieve products: ${getSafeErrorSummary(err)}`);

        throw new Error(this.homey.__('pair.login.error'));

      }

    });

  }

}
