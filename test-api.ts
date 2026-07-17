import { DeWarmteClient } from './src/api/client';
import { AuthService } from './src/api/auth';
import { ProductService } from './src/api/products';

async function main() {
  const email = process.env.DEWARMTE_EMAIL;
  const password = process.env.DEWARMTE_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'DEWARMTE_EMAIL and DEWARMTE_PASSWORD environment variables are required'
    );
  }

  const client = new DeWarmteClient();
  const auth = new AuthService(client);
  const products = new ProductService(client);

  console.log('Connecting to DeWarmte...');

  await auth.login(email, password);

  console.log('✅ Login successful');

  const product = await products.getProduct();
  const heatCurveSettings = await products.getHeatCurveSettings(product.id);

  console.log('✅ Product gevonden');
  console.log(`ID        : ${product.id}`);
  console.log(`Naam      : ${product.nickname}`);
  console.log(`Model     : ${product.type}`);
  console.log('Warmtelijninstellingen:');
  console.log(JSON.stringify(heatCurveSettings, null, 2));
}

main().catch((err) => {
  console.error(err);
});
