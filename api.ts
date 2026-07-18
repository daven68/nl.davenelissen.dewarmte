'use strict';

import Homey from 'homey';
import { HeatCurve } from './src/domain/HeatCurve';

type HeatCurveDevice = Homey.Device & {
  products?: {
    saveHeatCurve(productId: string, heatCurve: HeatCurve): Promise<HeatCurve>;
  };
  getHeatCurveForView(): Promise<HeatCurve>;
};

interface ApiRequest {
  homey: Homey.App['homey'];
  body?: HeatCurve;
  params?: {
    deviceId?: string;
  };
}

interface HeatCurveViewData {
  deviceId: string;
  name: string;
  heatCurve: HeatCurve;
}

module.exports = {
  async getHeatCurves({ homey }: ApiRequest): Promise<HeatCurveViewData[]> {
    const driver = homey.drivers.getDriver('dewarmte');
    const devices = driver.getDevices() as HeatCurveDevice[];

    if (devices.length === 0) {
      throw new Error('No paired DeWarmte devices found');
    }

    try {
      return await Promise.all(
        devices.map(async device => ({
          deviceId: String(device.getData().id),
          name: device.getName(),
          heatCurve: await device.getHeatCurveForView(),
        }))
      );
    } catch {
      homey.app.error('Failed to load Heat Curve data');
      throw new Error('Heat Curve data could not be loaded');
    }
  },

  async saveHeatCurve({
    homey,
    body,
    params,
  }: ApiRequest): Promise<HeatCurve> {
    const driver = homey.drivers.getDriver('dewarmte');
    const devices = driver.getDevices() as HeatCurveDevice[];
    const device = devices.find(
      item => String(item.getData().id) === params?.deviceId
    );

    if (!device || !body) {
      throw new Error('Heat Curve device or data is missing');
    }

    const productId = device.getSetting('productId');

    if (typeof productId !== 'string' || !productId || !device.products) {
      throw new Error('DeWarmte product service is not available');
    }

    try {
      return await device.products.saveHeatCurve(productId, body);
    } catch (error) {
      homey.app.error('Failed to save Heat Curve data', error);
      throw new Error(
        error instanceof Error
          ? error.message
          : 'Heat Curve data could not be saved'
      );
    }
  },
};
