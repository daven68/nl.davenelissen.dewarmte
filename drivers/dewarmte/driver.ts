'use strict';

const Homey = require('homey');

const { DeWarmteClient } = require('../../src/api/client');
const { AuthService } = require('../../src/api/auth');
const { ProductService } = require('../../src/api/products');

interface LoginData {
  email: string;
  password: string;
}

export = class DeWarmteDriver extends Homey.Driver {

  async onInit() {
    this.log('DeWarmte Driver initialized');
  }

  async onPair(session: any) {

    this.log('=== Pair session started ===');

    const client = new DeWarmteClient();
    const auth = new AuthService(client);
    const products = new ProductService(client);

    session.setHandler('login', async ({ email, password }: LoginData) => {

      this.log(`Login attempt for ${email}`);

      try {

        await auth.login(email, password);

        this.log('✅ Login successful');

        return true;

      } catch (err) {

        this.error('❌ Login failed');
        this.error(err);

        throw new Error('Inloggen bij DeWarmte mislukt');

      }

    });

    session.setHandler('list_devices', async () => {

      this.log('Listing products...');

      try {

        const productList = await products.getProducts();
        const refreshToken = client.getRefreshToken();

        if (!refreshToken) {
          throw new Error('DeWarmte refresh token is missing');
        }

        this.log(`Found ${productList.length} products`);

        return productList.map((product: any) => ({

          name: product.nickname || product.name,

          data: {
            id: product.id,
          },

          settings: {
            productId: product.id,
            model: product.type,
          },

          store: {
            refreshToken,
          },

        }));

      } catch (err) {

        this.error('Failed to retrieve products');
        this.error(err);

        throw err;

      }

    });

  }

}
