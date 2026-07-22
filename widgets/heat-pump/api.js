'use strict';

module.exports = {
  async getStatus({ homey, query }) {
    if (typeof query.deviceId !== 'string' || !query.deviceId) {
      throw new Error('No DeWarmte device selected');
    }

    const driver = homey.drivers.getDriver('dewarmte');
    const device = driver.getDevices().find((item) => {
      return item.getId() === query.deviceId;
    });

    if (!device) {
      throw new Error('Selected DeWarmte device was not found');
    }

    return {
      available: device.getAvailable(),
      values: {
        active: device.getCapabilityValue('pump_active'),
        thermostat: device.getCapabilityValue('thermostat_active'),
        gasBoiler: device.getCapabilityValue('gas_boiler_active'),
        alarm: device.getCapabilityValue('alarm_generic'),
        supplyTemperature: device.getCapabilityValue('measure_supply_temperature'),
        returnTemperature: device.getCapabilityValue('measure_temperature'),
        targetTemperature: device.getCapabilityValue('measure_target_temperature'),
        electricalPower: device.getCapabilityValue('measure_power'),
        heatInput: device.getCapabilityValue('measure_heat_input'),
        heatOutput: device.getCapabilityValue('measure_heat_output'),
        waterFlow: device.getCapabilityValue('measure_water_flow'),
      },
    };
  },
};
