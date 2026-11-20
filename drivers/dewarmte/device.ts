'use strict';

import Homey from 'homey';
import axios from 'axios';

import type { HeatCurve } from '../../src/domain/HeatCurve';
import type { Product, TopBarStatus } from '../../src/api/types';
import {
  DeWarmteSession,
  DeWarmteSessionRegistry,
  SessionExpiredError,
  SessionRegistryOwner,
  deriveSessionKey,
} from '../../src/api/session';
import { getSafeErrorSummary } from '../../src/util/errors';

const PUMP_STATE_TRIGGER_CARDS: Record<string, string> = {
  on: 'pump_state_on',
  heating: 'pump_state_heating',
  standby: 'pump_state_standby',
  defrosting: 'pump_state_defrosting',
  off: 'pump_state_off',
};

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
  'is_element_on',
  'fault_code',
];

const COMMON_CAPABILITIES = [
  'pump_active',
  'pump_state',
  'measure_power',
  'measure_heat_input',
  'measure_heat_output',
  'meter_power',
  'measure_cop_today',
  'alarm_generic',
];

const SPACE_HEATING_CAPABILITIES = [
  'measure_temperature',
  'measure_outdoor_temperature',
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
    .replace(/\beyJ[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[redacted-token]')
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

function getDiagnosticValueTypes(
  value: Record<string, unknown>,
): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>(
    (result, [key, nestedValue]) => {
      result[key] = getValueType(nestedValue);
      return result;
    },
    {},
  );
}

function getDiagnosticError(error: unknown): Record<string, unknown> {
  if (axios.isAxiosError(error)) {
    return {
      type: 'api-error',
      status: error.response?.status || null,
      code: error.code || null,
      message: sanitizeDiagnosticString(error.message),
    };
  }

  return {
    type: 'unknown-error',
    message: error instanceof Error
      ? sanitizeDiagnosticString(error.message)
      : 'Unknown error',
  };
}

/** The daily COP changes slowly, so it is fetched every 5 minutes. */
const INSIGHTS_INTERVAL_MS = 5 * 60 * 1000;

/** Date (YYYY-MM-DD) in the given time zone, as the DeWarmte API expects. */
function formatLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Longer gaps between two measurements are not counted in the kWh meter. */
const MAX_ENERGY_GAP_MS = 5 * 60 * 1000;

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
  private pollInProgress = false;
  private lastStatusSummary?: string;
  private lastPowerSample?: { at: number; kw: number };
  private lastInsightsAt = 0;
  private session?: DeWarmteSession;
  private sessionKey?: string;

  async onInit() {
    this.log('Device onInit()');

    const refreshToken = this.getStoreValue('refreshToken');

    if (typeof refreshToken !== 'string' || !refreshToken) {
      await this.setUnavailable(
        this.homey.__('device.session_missing'),
      );
      return;
    }

    await this.attachSession(refreshToken);

    try {
      await this.migrateCapabilities();
    } catch (err) {
      this.error(`Failed to migrate capabilities: ${getSafeErrorSummary(err)}`);
    }

    // Always start polling, also when the first attempt fails (for example
    // when Homey restarts without internet). The next successful poll makes
    // the device available again.
    this.startPolling();

    try {
      await this.poll();
    } catch (err) {
      await this.handlePollError(err);
    }
  }

  /**
   * A connection problem is retried automatically. An expired login can
   * only be solved by the user via Repair, so polling stops until then.
   */
  private async handlePollError(err: unknown): Promise<void> {
    if (err instanceof SessionExpiredError) {
      this.error('DeWarmte session expired, waiting for Repair');
      this.stopPolling();
      await this.setUnavailable(this.homey.__('device.session_expired'));
      return;
    }

    this.error(
      `Failed to poll DeWarmte product status, retrying automatically: ${getSafeErrorSummary(err)}`,
    );
    await this.setUnavailable(this.homey.__('device.connection_failed'));
  }

  /**
   * Called by the driver after the user signed in again via Repair.
   */
  async repairSession(refreshToken: string, sessionKey: string): Promise<void> {
    this.log('Repairing DeWarmte session');
    this.stopPolling();

    if (this.sessionKey) {
      this.registry.release(this.sessionKey, this.deviceKey);
    }

    await this.setStoreValue('refreshToken', refreshToken);
    await this.setStoreValue('sessionKey', sessionKey);
    await this.attachSession(refreshToken);

    try {
      await this.migrateCapabilities();
    } catch (err) {
      this.error(`Failed to migrate capabilities: ${getSafeErrorSummary(err)}`);
    }

    this.startPolling();

    try {
      await this.poll();
    } catch (err) {
      await this.handlePollError(err);
    }
  }

  async onUninit() {
    this.stopPolling();
  }

  async onDeleted() {
    this.stopPolling();

    if (this.sessionKey) {
      this.registry.release(this.sessionKey, this.deviceKey);
    }
  }

  /** Stable key of this device (the DeWarmte product ID from pairing). */
  private get deviceKey(): string {
    return String(this.getData().id);
  }

  private get registry(): DeWarmteSessionRegistry {
    return (this.driver as unknown as SessionRegistryOwner).sessions;
  }

  /**
   * Connects this device to the session shared by all devices of the same
   * DeWarmte login, so a refreshed token reaches every device.
   */
  private async attachSession(storedRefreshToken: string): Promise<void> {
    let sessionKey = this.getStoreValue('sessionKey');

    if (typeof sessionKey !== 'string' || !sessionKey) {
      sessionKey = deriveSessionKey(storedRefreshToken);
      await this.setStoreValue('sessionKey', sessionKey);
    }

    const session = this.registry.get(
      sessionKey,
      storedRefreshToken,
    );

    session.addListener(this.deviceKey, async (refreshToken: string) => {
      await this.setStoreValue('refreshToken', refreshToken);
    });

    const currentRefreshToken = session.client.getRefreshToken();

    if (currentRefreshToken && currentRefreshToken !== storedRefreshToken) {
      await this.setStoreValue('refreshToken', currentRefreshToken);
    }

    this.sessionKey = sessionKey;
    this.session = session;
  }

  private stopPolling(): void {
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
        await this.handlePollError(err);
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

    if (this.getCapabilityValue('meter_power') === null) {
      await this.setCapabilityValue('meter_power', 0);
    }

    for (const capability of unsupportedCapabilities) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability);
      }
    }

    for (const capability of ['target_temperature', 'measure_cop']) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability);
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.pollInProgress) {
      this.log('Skipping overlapping product status poll');
      return;
    }

    this.pollInProgress = true;
    let isConnected: boolean;

    try {
      isConnected = await this.updateCapabilities();

      if (isConnected) {
        await this.setAvailable();
      } else {
        await this.setUnavailable(this.homey.__('device.disconnected'));
      }
    } finally {
      this.pollInProgress = false;
    }
  }

  /**
   * Heat curve (stooklijn) of this heat pump. Not used yet; kept for the
   * planned heat curve feature.
   */
  async getHeatCurveForView(): Promise<HeatCurve> {
    return this.getSession().getHeatCurve(this.getProductId());
  }

  async getDiagnosticReport(
    captureContext = 'normal',
  ): Promise<Record<string, unknown>> {
    this.log('Creating privacy-safe diagnostic report');
    const product = await this.getCurrentProduct();
    let rawSettings: unknown = null;
    let settingsError: Record<string, unknown> | null = null;

    try {
      rawSettings = await this.getSession().getOperationSettings(
        this.getProductId(),
      );
    } catch (error) {
      this.error(
        `Diagnostic settings unavailable: ${getSafeErrorSummary(error)}`,
      );
      settingsError = getDiagnosticError(error);
    }

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
    const settings: Record<string, unknown> = rawSettings
      && typeof rawSettings === 'object'
      && !Array.isArray(rawSettings)
      ? rawSettings as Record<string, unknown>
      : {};

    const report = {
      diagnosticVersion: 2,
      captureContext,
      generatedAt: new Date().toISOString(),
      appVersion: Homey.manifest.version,
      productType,
      available: this.getAvailable(),
      apiStatusContainerType: getValueType(rawStatus),
      apiStatus: sanitizeDiagnosticValue(status),
      apiStatusTypes: getDiagnosticValueTypes(status),
      missingExpectedStatusFields: expectedStatusFields.filter((key) => {
        return !statusKeys.includes(key);
      }),
      nullStatusFields: statusEntries
        .filter(([, value]) => value === null || value === undefined)
        .map(([key]) => key),
      apiSettingsContainerType: getValueType(rawSettings),
      apiSettings: sanitizeDiagnosticValue(rawSettings),
      apiSettingsTypes: getDiagnosticValueTypes(settings),
      apiSettingsError: settingsError,
      productFeatures: {
        coolingSupported: product.cooling === true,
        relatedPompAoPresent: Boolean(product.related_ao),
        elementStatusReported: Object.prototype.hasOwnProperty.call(
          status,
          'is_element_on',
        ),
      },
      homeyCapabilities: capabilities,
      privacy: {
        productIdIncluded: false,
        deviceIdIncluded: false,
        deviceNameIncluded: false,
        credentialsIncluded: false,
        settingsSanitized: true,
      },
    };

    this.log('Privacy-safe diagnostic report created');
    return report;
  }

  private getSession(): DeWarmteSession {
    if (!this.session) {
      throw new Error('DeWarmte session has not been initialized');
    }

    return this.session;
  }

  private getProductId(): string {
    const productId = this.getSetting('productId');

    if (typeof productId !== 'string' || !productId) {
      throw new Error('DeWarmte productId setting is missing');
    }

    return productId;
  }

  private async getCurrentProduct(): Promise<Product> {
    const productId = this.getProductId();
    const products = await this.getSession().getProducts();
    const product = products.find((item) => item.id === productId);

    if (!product) {
      throw new Error(`DeWarmte product ${productId} was not found`);
    }

    return product;
  }

  /**
   * COP of today, exactly as the DeWarmte app shows it under Insights > Day.
   * A failure here never makes the device unavailable.
   */
  private async updateDailyInsights(): Promise<void> {
    if (
      !this.hasCapability('measure_cop_today')
      || Date.now() - this.lastInsightsAt < INSIGHTS_INTERVAL_MS
    ) {
      return;
    }

    this.lastInsightsAt = Date.now();

    try {
      const today = formatLocalDate(new Date(), this.homey.clock.getTimezone());
      const insights = await this.getSession().getInsights(
        this.getProductId(),
        today,
        'hourly', // = the "Day" tab of the DeWarmte app
      );
      const cop = typeof insights.cop === 'number'
        && Number.isFinite(insights.cop)
        && insights.cop > 0
        && typeof insights.electricity_sum === 'number'
        && insights.electricity_sum > 0
        ? Math.round(insights.cop * 10) / 10
        : null;

      await this.setCapabilityValue('measure_cop_today', cop);
    } catch (err) {
      this.error(`Daily insights unavailable: ${getSafeErrorSummary(err)}`);
    }
  }

  /**
   * DeWarmte only reports the current electrical power, so the kWh meter
   * (used by Homey Energy) adds up power x time between two measurements.
   */
  private async updateEnergyMeter(electricalKw: unknown): Promise<void> {
    if (
      typeof electricalKw !== 'number'
      || !Number.isFinite(electricalKw)
      || electricalKw < 0
      || !this.hasCapability('meter_power')
    ) {
      return;
    }

    const now = Date.now();
    const previous = this.lastPowerSample;
    this.lastPowerSample = { at: now, kw: electricalKw };

    if (!previous) {
      return;
    }

    const elapsedMs = now - previous.at;

    if (elapsedMs <= 0 || elapsedMs > MAX_ENERGY_GAP_MS) {
      return;
    }

    const hours = elapsedMs / (60 * 60 * 1000);
    const addedKwh = ((previous.kw + electricalKw) / 2) * hours;
    const current = Number(this.getCapabilityValue('meter_power')) || 0;

    await this.setCapabilityValue(
      'meter_power',
      Math.round((current + addedKwh) * 10000) / 10000,
    );
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

  private async triggerFlowCard(
    cardId: string,
    tokens: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens);
    } catch (error) {
      this.error(`Failed to trigger Flow card ${cardId}: ${getSafeErrorSummary(error)}`);
    }
  }

  private async triggerPumpStateFlowCards(
    previousState: unknown,
    currentState: unknown,
  ): Promise<void> {
    if (
      typeof previousState !== 'string'
      || typeof currentState !== 'string'
      || previousState === currentState
    ) {
      return;
    }

    await this.triggerFlowCard('pump_state_changed', {
      state: this.homey.__(`flow.pumpState.${currentState}`) || currentState,
    });

    const stateTriggerCard = PUMP_STATE_TRIGGER_CARDS[currentState];

    if (stateTriggerCard) {
      await this.triggerFlowCard(stateTriggerCard);
    }
  }

  private async triggerBooleanFlowCards(
    capability: string,
    previousValue: unknown,
    currentValue: unknown,
  ): Promise<void> {
    if (
      typeof previousValue !== 'boolean'
      || typeof currentValue !== 'boolean'
      || previousValue === currentValue
    ) {
      return;
    }

    await this.triggerFlowCard(`${capability}_${currentValue}`);
  }

  private async triggerTargetTemperatureFlowCard(
    previousValue: unknown,
    currentValue: unknown,
  ): Promise<void> {
    if (
      typeof previousValue !== 'number'
      || typeof currentValue !== 'number'
      || !Number.isFinite(currentValue)
      || previousValue === currentValue
    ) {
      return;
    }

    await this.triggerFlowCard('measure_target_temperature_changed', {
      temperature: currentValue,
    });
  }

  private async updateCapabilities(): Promise<boolean> {
    const product = await this.getCurrentProduct();
    const pompT = isPompT(product.type || this.getSetting('model'));
    let topBarStatus: TopBarStatus | null = null;

    if (!pompT) {
      try {
        topBarStatus = await this.getSession().getTopBarStatus();
      } catch (error) {
        this.error(
          `Top bar status unavailable: ${getSafeErrorSummary(error)}`,
        );
      }
    }

    const currentGasBoiler = typeof topBarStatus?.is_gas_boiler_on === 'boolean'
      ? topBarStatus.is_gas_boiler_on
      : product.status.gas_boiler;
    const currentThermostat = typeof topBarStatus?.is_thermostat_on === 'boolean'
      ? topBarStatus.is_thermostat_on
      : product.status.thermostat;
    const previousPumpState = this.getCapabilityValue('pump_state');
    const previousTargetTemperature = this.getCapabilityValue(
      'measure_target_temperature',
    );
    const previousGasBoiler = this.getCapabilityValue('gas_boiler_active');
    const previousThermostat = this.getCapabilityValue('thermostat_active');
    const reportedPumpState = typeof product.status.state === 'string'
      ? product.status.state.trim().toLowerCase()
      : '';
    const normalizedPumpState = reportedPumpState.replace(/[\s_-]+/g, '');
    const supportedPumpStates = new Set([
      'off',
      'standby',
      'heating',
      'defrosting',
    ]);
    let currentPumpState = product.status.is_on ? 'on' : 'off';

    if (supportedPumpStates.has(normalizedPumpState)) {
      currentPumpState = normalizedPumpState;
    }

    const errors = Array.isArray(product.status.errors) ? product.status.errors : [];
    const hasAlarm = hasFault(product.status);

    const statusSummary = (
      `Status: actual=${product.status.actual_temperature}, `
      + `target=${product.status.target_temperature}, `
      + `state=${reportedPumpState || 'missing'}, `
      + `mappedState=${currentPumpState}, `
      + `fault=${product.status.fault_code}, `
      + `errorCount=${errors.length}, `
      + `gasBoiler=${currentGasBoiler}, `
      + `gasBoilerReported=${product.status.gas_boiler === true}, `
      + `thermostat=${currentThermostat}, `
      + `hasAlarm=${hasAlarm}`
    );

    // Only log when the status actually changed, to keep the logs readable.
    if (statusSummary !== this.lastStatusSummary) {
      this.log(statusSummary);
      this.lastStatusSummary = statusSummary;
    }

    const capabilityUpdates: Promise<void>[] = [
      this.setCapabilityValueIfPresent('pump_active', product.status.is_on),
      this.setCapabilityValueIfPresent(
        'measure_power',
        product.status.electricity_consumption * 1000,
      ),
      this.setCapabilityValueIfPresent('measure_heat_input', product.status.heat_input),
      this.setCapabilityValueIfPresent('measure_heat_output', product.status.heat_output),
      this.updateEnergyMeter(product.status.electricity_consumption),
      this.setCapabilityValueIfPresent(
        'pump_state',
        currentPumpState,
      ),
      this.setCapabilityValueIfPresent('alarm_generic', hasAlarm),
    ];

    if (pompT) {
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
          'measure_outdoor_temperature',
          topBarStatus?.outdoor_temperature,
        ),
        this.setCapabilityValueIfPresent(
          'gas_boiler_active',
          currentGasBoiler,
        ),
        this.setCapabilityValueIfPresent(
          'measure_water_flow',
          product.status.water_flow,
        ),
        this.setCapabilityValueIfPresent(
          'thermostat_active',
          currentThermostat,
        ),
      );
    }

    await Promise.all(capabilityUpdates);
    await this.updateDailyInsights();

    await this.triggerPumpStateFlowCards(
      previousPumpState,
      currentPumpState,
    );

    if (!pompT) {
      await this.triggerTargetTemperatureFlowCard(
        previousTargetTemperature,
        this.getCapabilityValue('measure_target_temperature'),
      );
      await this.triggerBooleanFlowCards(
        'gas_boiler_active',
        previousGasBoiler,
        this.getCapabilityValue('gas_boiler_active'),
      );
      await this.triggerBooleanFlowCards(
        'thermostat_active',
        previousThermostat,
        this.getCapabilityValue('thermostat_active'),
      );
    }

    return product.status.is_connected !== false;
  }
}

module.exports = DeWarmteDevice;
