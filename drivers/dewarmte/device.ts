'use strict';

import type { HeatCurve } from '../../src/domain/HeatCurve';
import type { Product } from '../../src/api/types';

const Homey = require('homey');
const axios: typeof import('axios') = require('axios');

const { DeWarmteClient } = require('../../src/api/client');
const { AuthService } = require('../../src/api/auth');
const { ProductService } = require('../../src/api/products');

const COMMON_EXPECTED_STATUS_FIELDS = [
  'time',
  'is_on',
  'heat_input',
  'heat_output',
  'electricity_consumption',
  'errors',
  'is_connected',
];

const SPACE_HEATING_STATUS_FIELDS = [
  'water_flow',
  'gas_boiler',
  'thermostat',
  'supply_temperature',
  'actual_temperature',
  'target_temperature',
  'fault_code',
  'electric_backup_usage',
];

const POMP_T_STATUS_FIELDS = [
  'top_boiler_temp',
  'bottom_boiler_temp',
  'fault_code',
];

const COMMON_CAPABILITIES = [
  'pump_active',
  'pump_state',
  'measure_power',
  'measure_heat_input',
  'measure_heat_output',
  'alarm_generic',
];

const SPACE_HEATING_CAPABILITIES = [
  'measure_temperature',
  'measure_target_temperature',
  'measure_supply_temperature',
  'measure_water_flow',
  'gas_boiler_active',
  'thermostat_active',
];

const POMP_T_CAPABILITIES = [
  'measure_boiler_temperature_top',
  'measure_boiler_temperature_bottom',
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

function normalizeProductType(productType: unknown): string {
  return String(productType || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isPompT(productType: unknown): boolean {
  const normalizedType = normalizeProductType(productType);
  return normalizedType === 'PT' || normalizedType === 'POMPT';
}

function hasFault(status: Product['status']): boolean {
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const faultCode = status.fault_code;
  let hasFaultCode = false;

  if (typeof faultCode === 'number') {
    hasFaultCode = ![0, -1].includes(faultCode);
  } else if (typeof faultCode === 'string') {
    const normalizedFaultCode = faultCode.trim().toLowerCase();
    hasFaultCode = !['', '0', '-1', 'none', 'null'].includes(
      normalizedFaultCode,
    );
  }

  return hasFaultCode || errors.length > 0;
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

    const pompT = isPompT(this.getSetting('model'));
    const modelCapabilities = pompT
      ? POMP_T_CAPABILITIES
      : SPACE_HEATING_CAPABILITIES;
    const desiredCapabilities = [
      ...COMMON_CAPABILITIES,
      ...modelCapabilities,
    ];
    const unsupportedCapabilities = pompT
      ? SPACE_HEATING_CAPABILITIES
      : POMP_T_CAPABILITIES;

    for (const capability of desiredCapabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    for (const capability of unsupportedCapabilities) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability);
      }
    }

    if (this.hasCapability('target_temperature')) {
      await this.removeCapability('target_temperature');
    }
  }

  private async poll(): Promise<void> {
    let isConnected: boolean;

    try {
      isConnected = await this.updateCapabilities();
    } catch (err) {
      if (!axios.isAxiosError(err) || err.response?.status !== 401) {
        throw err;
      }

      await this.refreshSession();
      isConnected = await this.updateCapabilities();
    }

    if (isConnected) {
      await this.setAvailable();
    } else {
      await this.setUnavailable(this.homey.__('device.disconnected'));
    }
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
    const productType = product.type || this.getSetting('model') || 'unknown';
    const expectedStatusFields = [
      ...COMMON_EXPECTED_STATUS_FIELDS,
      ...(isPompT(productType)
        ? POMP_T_STATUS_FIELDS
        : SPACE_HEATING_STATUS_FIELDS),
    ];
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
      productType,
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
      missingExpectedStatusFields: expectedStatusFields.filter((key) => {
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

  private async setCapabilityValueIfPresent(
    capability: string,
    value: unknown,
  ): Promise<void> {
    if (!this.hasCapability(capability) || value === undefined) {
      return;
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      return;
    }

    await this.setCapabilityValue(capability, value);
  }

  private async updateCapabilities(): Promise<boolean> {
    this.log('refreshDevice() called');

    const product = await this.getCurrentProduct();

    this.log(`Product received: ${product.id}`);

    const errors = Array.isArray(product.status.errors) ? product.status.errors : [];
    const hasAlarm = hasFault(product.status);

    this.log(
      `Status updated: actual=${product.status.actual_temperature}, `
      + `target=${product.status.target_temperature}, `
      + `fault=${product.status.fault_code}, `
      + `errors=${JSON.stringify(errors)}, `
      + `hasAlarm=${hasAlarm}`,
    );

    const capabilityUpdates: Promise<void>[] = [
      this.setCapabilityValueIfPresent('pump_active', product.status.is_on),
      this.setCapabilityValueIfPresent(
        'measure_power',
        product.status.electricity_consumption * 1000,
      ),
      this.setCapabilityValueIfPresent('measure_heat_input', product.status.heat_input),
      this.setCapabilityValueIfPresent('measure_heat_output', product.status.heat_output),
      this.setCapabilityValueIfPresent(
        'pump_state',
        product.status.is_on ? 'on' : 'off',
      ),
      this.setCapabilityValueIfPresent('alarm_generic', hasAlarm),
    ];

    if (isPompT(product.type || this.getSetting('model'))) {
      capabilityUpdates.push(
        this.setCapabilityValueIfPresent(
          'measure_boiler_temperature_top',
          product.status.top_boiler_temp,
        ),
        this.setCapabilityValueIfPresent(
          'measure_boiler_temperature_bottom',
          product.status.bottom_boiler_temp,
        ),
      );
    } else {
      capabilityUpdates.push(
        this.setCapabilityValueIfPresent(
          'measure_temperature',
          product.status.actual_temperature,
        ),
        this.setCapabilityValueIfPresent(
          'measure_target_temperature',
          product.status.target_temperature,
        ),
        this.setCapabilityValueIfPresent(
          'measure_supply_temperature',
          product.status.supply_temperature,
        ),
        this.setCapabilityValueIfPresent(
          'gas_boiler_active',
          product.status.gas_boiler,
        ),
        this.setCapabilityValueIfPresent(
          'measure_water_flow',
          product.status.water_flow,
        ),
        this.setCapabilityValueIfPresent(
          'thermostat_active',
          product.status.thermostat,
        ),
      );
    }

    await Promise.all(capabilityUpdates);

    this.log('Capabilities updated');

    return product.status.is_connected !== false;
  }
}

module.exports = DeWarmteDevice;
