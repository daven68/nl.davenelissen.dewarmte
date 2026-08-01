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

    const getCapabilityValue = (capability) => {
      return device.hasCapability(capability)
        ? device.getCapabilityValue(capability)
        : null;
    };

    return {
      available: device.getAvailable(),
      productType: device.getSetting('model') || null,
      values: {
        active: getCapabilityValue('pump_active'),
        thermostat: getCapabilityValue('thermostat_active'),
        gasBoiler: getCapabilityValue('gas_boiler_active'),
        alarm: getCapabilityValue('alarm_generic'),
        supplyTemperature: getCapabilityValue('measure_supply_temperature'),
        returnTemperature: getCapabilityValue('measure_temperature'),
        targetTemperature: getCapabilityValue('measure_target_temperature'),
        boilerTopTemperature: getCapabilityValue('measure_boiler_temperature_top'),
        boilerBottomTemperature: getCapabilityValue('measure_boiler_temperature_bottom'),
        electricalPower: getCapabilityValue('measure_power'),
        heatInput: getCapabilityValue('measure_heat_input'),
        heatOutput: getCapabilityValue('measure_heat_output'),
        waterFlow: getCapabilityValue('measure_water_flow'),
      },
    };
  },
};
