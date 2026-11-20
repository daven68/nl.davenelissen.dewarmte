'use strict';

import Homey from 'homey';
import type PairSession from 'homey/lib/PairSession';

import type { Product } from '../../src/api/types';
import { AuthService } from '../../src/api/auth';
import { DeWarmteClient } from '../../src/api/client';
import { ProductService } from '../../src/api/products';
import { DeWarmteSessionRegistry, createSessionKey } from '../../src/api/session';
import { getSafeErrorSummary } from '../../src/util/errors';

/** The parts of a DeWarmte device the driver uses during Repair. */
interface RepairableDevice extends Homey.Device {
  repairSession(refreshToken: string, sessionKey: string): Promise<void>;
}

interface LoginData {
  email: string;
  password: string;
}

interface TargetSupplyTemperatureConditionArgs {
  device: Homey.Device;
  temperature: number;
}

interface PumpStateConditionArgs {
  device: Homey.Device;
  state: string;
}

export = class DeWarmteDriver extends Homey.Driver {

  public readonly sessions = new DeWarmteSessionRegistry();

  /** Privacy-safe error description, also used by api.js. */
  public summarizeError(error: unknown): string {
    return getSafeErrorSummary(error);
  }

  async onInit() {
    this.log('DeWarmte Driver initialized');

    this.homey.flow
      .getConditionCard('pump_state_is')
      .registerRunListener(({ device, state }: PumpStateConditionArgs) => {
        return device.getCapabilityValue('pump_state') === state;
      });

    this.homey.flow
      .getConditionCard('pump_is_on')
      .registerRunListener(({ device }: { device: Homey.Device }) => {
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
      .registerRunListener(({ device }: { device: Homey.Device }) => {
        return device.getCapabilityValue('gas_boiler_active') === true;
      });

    this.homey.flow
      .getConditionCard('thermostat_is_active')
      .registerRunListener(({ device }: { device: Homey.Device }) => {
        return device.getCapabilityValue('thermostat_active') === true;
      });
  }

  async onPair(session: PairSession) {

    this.log('=== Pair session started ===');

    const client = new DeWarmteClient();
    const auth = new AuthService(client);
    const products = new ProductService(client);
    const sessionKey = createSessionKey();

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
            sessionKey,
          },

        }));

      } catch (err) {

        this.error(`Failed to retrieve products: ${getSafeErrorSummary(err)}`);

        throw new Error(this.homey.__('pair.login.error'));

      }

    });

  }

  /**
   * Repair: sign in again without removing the device, so Flows and
   * Insights are kept. All devices that shared the expired login are
   * reconnected at once.
   */
  async onRepair(session: PairSession, device: RepairableDevice) {
    this.log('=== Repair session started ===');

    session.setHandler('login', async ({ email, password }: LoginData) => {
      const client = new DeWarmteClient();
      const auth = new AuthService(client);
      const products = new ProductService(client);

      try {
        await auth.login(email, password);
      } catch (err) {
        this.error(`Repair login failed: ${getSafeErrorSummary(err)}`);
        throw new Error(this.homey.__('pair.login.error'));
      }

      let productIds: string[];

      try {
        const productList: Product[] = await products.getProducts();
        productIds = productList.map((product) => product.id);
      } catch (err) {
        this.error(`Repair product lookup failed: ${getSafeErrorSummary(err)}`);
        throw new Error(this.homey.__('pair.login.error'));
      }

      if (!productIds.includes(device.getSetting('productId'))) {
        throw new Error(this.homey.__('repair.login.wrong_account'));
      }

      const refreshToken = client.getRefreshToken();

      if (!refreshToken) {
        throw new Error(this.homey.__('pair.login.error'));
      }

      const oldSessionKey = device.getStoreValue('sessionKey');
      const newSessionKey = createSessionKey();
      const devicesToRepair = (this.getDevices() as RepairableDevice[]).filter(
        (item) => {
          return item === device || (
            typeof oldSessionKey === 'string'
            && oldSessionKey !== ''
            && item.getStoreValue('sessionKey') === oldSessionKey
            && productIds.includes(item.getSetting('productId'))
          );
        },
      );

      for (const item of devicesToRepair) {
        await item.repairSession(refreshToken, newSessionKey);
      }

      this.log(`Repair successful for ${devicesToRepair.length} device(s)`);
      return true;
    });
  }

}
