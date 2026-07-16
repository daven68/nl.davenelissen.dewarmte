'use strict';

const Homey = require('homey');

class DeWarmteDevice extends Homey.Device {

  async onInit() {
    this.log(`${this.getName()} initialized`);
  }

}

module.exports = DeWarmteDevice;