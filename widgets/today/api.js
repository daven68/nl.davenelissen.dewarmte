'use strict';

module.exports = {
  async getToday({ homey, query }) {
    if (typeof query.deviceId !== 'string' || !query.deviceId) {
      throw new Error('No DeWarmte device selected');
    }

    const device = homey.drivers.getDriver('dewarmte').getDevices().find((item) => {
      return item.getId() === query.deviceId;
    });

    if (!device) {
      throw new Error('Selected DeWarmte device was not found');
    }

    return {
      available: device.getAvailable(),
      copToday: device.hasCapability('measure_cop_today')
        ? device.getCapabilityValue('measure_cop_today')
        : null,
    };
  },
};
