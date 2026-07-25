'use strict';

function getDriver(homey) {
  return homey.drivers.getDriver('dewarmte');
}

module.exports = {
  async getDiagnosticDevices({ homey }) {
    return getDriver(homey).getDevices().map((device) => ({
      id: device.getId(),
      name: device.getName(),
      model: device.getSetting('model') || null,
    }));
  },

  async getDiagnosticReport({ homey, params }) {
    const device = getDriver(homey).getDevices().find((item) => {
      return item.getId() === params.deviceId;
    });

    if (!device) {
      throw new Error('Selected DeWarmte device was not found');
    }

    return device.getDiagnosticReport();
  },
};
