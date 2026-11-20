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

  async getDiagnosticReport({ homey, params, query }) {
    try {
      const device = getDriver(homey).getDevices().find((item) => {
        return item.getId() === params.deviceId;
      });

      if (!device) {
        throw new Error('Selected DeWarmte device was not found');
      }

      const allowedContexts = ['normal', 'boost-on', 'boost-off'];
      const captureContext = allowedContexts.includes(query?.context)
        ? query.context
        : 'normal';

      return await device.getDiagnosticReport(captureContext);
    } catch (error) {
      getDriver(homey).error(
        `[Diagnostics] Report creation failed: ${getDriver(homey).summarizeError(error)}`,
      );
      throw new Error('Unable to create diagnostic report');
    }
  },
};
