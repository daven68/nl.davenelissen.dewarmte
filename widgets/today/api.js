'use strict';

const PERIODS = ['day', 'week', 'month', 'year'];

module.exports = {
  async getCop({ homey, query }) {
    if (typeof query.deviceId !== 'string' || !query.deviceId) {
      throw new Error('No DeWarmte device selected');
    }

    const device = homey.drivers.getDriver('dewarmte').getDevices().find((item) => {
      return item.getId() === query.deviceId;
    });

    if (!device) {
      throw new Error('Selected DeWarmte device was not found');
    }

    const period = PERIODS.includes(query.period) ? query.period : 'day';

    return {
      available: device.getAvailable(),
      period,
      cop: await device.getCopForPeriod(period),
    };
  },
};
