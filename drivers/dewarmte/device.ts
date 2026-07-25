'use strict';

import type { HeatCurve } from '../../src/domain/HeatCurve';
import type { Product } from '../../src/api/types';

const Homey = require('homey');
const axios: typeof import('axios') = require('axios');

const { DeWarmteClient } = require('../../src/api/client');
const { AuthService } = require('../../src/api/auth');
const { ProductService } = require('../../src/api/products');

const EXPECTED_STATUS_FIELDS = [
  'time',
  'is_on',
  'heat_input',
  'heat_output',
  'water_flow',
  'electricity_consumption',
  'gas_boiler',
  'thermostat',
  'supply_temperature',
  'actual_temperature',
  'target_temperature',
  'fault_code',
  'electric_backup_usage',
  'errors',
  'is_connected',
];

const SENSITIVE_STATUS_KEY = /(?:token|secret|password|email|serial|address|phone|customer|account|name|location|(?:^|_)(?:id|uuid|mac|ip)(?:$|_))/i;

function sanitizeDiagnosticString(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[redacted-email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted-uuid]')
    .replace(/\b(?:bearer\s+)?[a-z0-9_-]{40,}\b/gi, '[redacted-token]');
}

function sanitizeDiagnosticValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_STATUS_KEY.test(key)) {
    return '[redacted]';
  }

  if (depth >= 5) {
    return '[maximum depth reached]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => {
      return sanitizeDiagnosticValue(item, key, depth + 1);
    });
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).slice(0, 200).reduce<Record<string, unknown>>(
      (result, [nestedKey, nestedValue]) => {
        result[nestedKey] = sanitizeDiagnosticValue(
          nestedValue,
          nestedKey,
          depth + 1,
        );
        return result;
      },
      {},
    );
  }

  if (typeof value === 'string') {
    const sanitizedValue = sanitizeDiagnosticString(value);
    return sanitizedValue.length > 1000
      ? `${sanitizedValue.slice(0, 1000)}…`
      : sanitizedValue;
  }

  return value;
}

function getValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

class DeWarmteDevice extends Homey.Device {
  private pollTimer?: NodeJS.Timeout;
  private client?: InstanceType<typeof DeWarmteClient>;
  private auth?: InstanceType<typeof AuthService>;
  private products?: InstanceType<typeof ProductService>;

  async onInit() {
    this.log('Device onInit()');

    const refreshToken = this.getStoreValue('refreshToken');

    if (typeof refreshToken !== 'string' || !refreshToken) {
      await this.setUnavailable(
        this.homey.__('device.session_missing'),
      );
      return;
    }

    this.client = new DeWarmteClient();
    this.client.setRefreshToken(refreshToken);
    this.auth = new AuthService(this.client);
    this.products = new ProductService(this.client);

    try {
      await this.migrateCapabilities();
      await this.refreshSession();
      await this.poll();
      this.startPolling();
    } catch (err) {
      this.error('Failed to initialize DeWarmte polling', err);
      await this.setUnavailable(this.homey.__('device.connection_failed'));
    }
  }

  async onDeleted() {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = this.homey.setInterval(() => {
      this.poll().catch(async (err) => {
        this.error('Failed to poll DeWarmte product status', err);
        await this.setUnavailable(this.homey.__('device.connection_failed'));
      });
    }, 30 * 1000);

    this.log('Polling timer started');
  }

  private async migrateCapabilities(): Promise<void> {
    if (this.getClass() !== 'heatpump') {
      await this.setClass('heatpump');
    }

    if (!this.hasCapability('measure_target_temperature')) {
      await this.addCapability('measure_target_temperature');
    }

    if (!this.hasCapability('pump_active')) {
      await this.addCapability('pump_active');
    }

    if (!this.hasCapability('pump_state')) {
      await this.addCapability('pump_state');
    }

    if (!this.hasCapability('measure_power')) {
      await this.addCapability('measure_power');
    }

    if (!this.hasCapability('gas_boiler_active')) {
      await this.addCapability('gas_boiler_active');
    }

    const additionalCapabilities = [
      'measure_supply_temperature',
      'measure_heat_input',
      'measure_heat_output',
      'measure_water_flow',
      'thermostat_active',
    ];

    for (const capability of additionalCapabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    if (this.hasCapability('target_temperature')) {
      await this.removeCapability('target_temperature');
    }
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

  async getHeatCurveForView(): Promise<HeatCurve> {
    if (!this.products) {
      throw new Error('DeWarmte product service has not been initialized');
    }

    const productId = this.getSetting('productId');

    if (typeof productId !== 'string' || !productId) {
      throw new Error('DeWarmte productId setting is missing');
    }

    try {
      return await this.products.getHeatCurve(productId);
    } catch (err) {
      if (!axios.isAxiosError(err) || err.response?.status !== 401) {
        throw err;
      }

      await this.refreshSession();
      return this.products.getHeatCurve(productId);
    }
  }

  async getDiagnosticReport(): Promise<Record<string, unknown>> {
    const product = await this.getCurrentProductWithSessionRetry();
    const rawStatus: unknown = product.status;
    const status: Record<string, unknown> = rawStatus
      && typeof rawStatus === 'object'
      && !Array.isArray(rawStatus)
      ? rawStatus as Record<string, unknown>
      : {};
    const statusEntries = Object.entries(status);
    const statusKeys = Object.keys(status);
    const capabilityIds: string[] = this.getCapabilities();
    const capabilities = capabilityIds.reduce<Record<string, unknown>>(
      (result: Record<string, unknown>, capability: string) => {
        result[capability] = this.getCapabilityValue(capability);
        return result;
      },
      {},
    );

    return {
      diagnosticVersion: 1,
      generatedAt: new Date().toISOString(),
      appVersion: Homey.manifest.version,
      productType: product.type || this.getSetting('model') || 'unknown',
      available: this.getAvailable(),
      apiStatusContainerType: getValueType(rawStatus),
      apiStatus: sanitizeDiagnosticValue(status),
      apiStatusTypes: statusEntries.reduce<Record<string, string>>(
        (result, [key, value]) => {
          result[key] = getValueType(value);
          return result;
        },
        {},
      ),
      missingExpectedStatusFields: EXPECTED_STATUS_FIELDS.filter((key) => {
        return !statusKeys.includes(key);
      }),
      nullStatusFields: statusEntries
        .filter(([, value]) => value === null || value === undefined)
        .map(([key]) => key),
      homeyCapabilities: capabilities,
      privacy: {
        productIdIncluded: false,
        deviceIdIncluded: false,
        deviceNameIncluded: false,
        credentialsIncluded: false,
      },
    };
  }

  private async getCurrentProductWithSessionRetry(): Promise<Product> {
    try {
      return await this.getCurrentProduct();
    } catch (err) {
      if (!axios.isAxiosError(err) || err.response?.status !== 401) {
        throw err;
      }

      await this.refreshSession();
      return this.getCurrentProduct();
    }
  }

  private async getCurrentProduct(): Promise<Product> {
    if (!this.products) {
      throw new Error('DeWarmte product service has not been initialized');
    }

    const productId = this.getSetting('productId');

    if (typeof productId !== 'string' || !productId) {
      throw new Error('DeWarmte productId setting is missing');
    }

    const products = await this.products.getProducts();
    const product = products.find((item: Product) => item.id === productId);

    if (!product) {
      throw new Error(`DeWarmte product ${productId} was not found`);
    }

    return product;
  }

  private async updateCapabilities(): Promise<void> {
    this.log('refreshDevice() called');

    const product = await this.getCurrentProduct();

    this.log(`Product received: ${product.id}`);

    const errors = Array.isArray(product.status.errors)
      ? product.status.errors
      : [];

    const hasAlarm = ![0, -1].includes(product.status.fault_code)
      || errors.length > 0;

    this.log(
      `Status updated: actual=${product.status.actual_temperature}, `
      + `target=${product.status.target_temperature}, `
      + `fault=${product.status.fault_code}, `
      + `errors=${JSON.stringify(errors)}, `
      + `hasAlarm=${hasAlarm}`,
    );

    const capabilityUpdates = [
      this.setCapabilityValue('pump_active', product.status.is_on),
      this.setCapabilityValue(
        'measure_temperature',
        product.status.actual_temperature,
      ),
      this.setCapabilityValue(
        'measure_target_temperature',
        product.status.target_temperature,
      ),
      this.setCapabilityValue(
        'measure_supply_temperature',
        product.status.supply_temperature,
      ),
      this.setCapabilityValue(
        'measure_power',
        product.status.electricity_consumption * 1000,
      ),
      this.setCapabilityValue(
        'gas_boiler_active',
        product.status.gas_boiler,
      ),
      this.setCapabilityValue(
        'measure_heat_input',
        product.status.heat_input,
      ),
      this.setCapabilityValue(
        'measure_heat_output',
        product.status.heat_output,
      ),
      this.setCapabilityValue(
        'measure_water_flow',
        product.status.water_flow,
      ),
      this.setCapabilityValue(
        'thermostat_active',
        product.status.thermostat,
      ),
      this.setCapabilityValue(
        'pump_state',
        product.status.is_on ? 'on' : 'off',
      ),
      this.setCapabilityValue('alarm_generic', hasAlarm),
    ];

    await Promise.all(capabilityUpdates);

    this.log('Capabilities updated');
  }
}

module.exports = DeWarmteDevice;
