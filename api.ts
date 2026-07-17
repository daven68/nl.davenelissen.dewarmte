'use strict';

import Homey from 'homey';
import { HeatCurve } from './src/domain/HeatCurve';

type HeatCurveDevice = Homey.Device & {
  getHeatCurveForView(): Promise<HeatCurve>;
};

interface ApiRequest {
  homey: Homey.App['homey'];
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
};
