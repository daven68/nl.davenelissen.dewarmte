'use strict';

const Homey = require('homey');

class DeWarmteDriver extends Homey.Driver {

  async onInit() {
    this.log('DeWarmte Driver initialized');
  }

  async onPair(session) {
    this.log('Pair session started');

    session.setHandler('login', async (data) => {
      this.log('Login requested');

      return {
        success: true
      };
    });
  }

}

module.exports = DeWarmteDriver;