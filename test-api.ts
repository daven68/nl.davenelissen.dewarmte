import { DeWarmteClient } from './src/api/client';
import { AuthService } from './src/api/auth';
import { ProductService } from './src/api/products';

async function main() {
  const email = process.env.DEWARMTE_EMAIL;
  const password = process.env.DEWARMTE_PASSWORD;

  const client = new DeWarmteClient();
  const auth = new AuthService(client);
  const products = new ProductService(client);

  console.log('Connecting to DeWarmte...');

  await auth.login(email, password);

  console.log('✅ Login successful');

  const product = await products.getProduct();

  console.log('✅ Product gevonden');
  console.log(`Naam      : ${product.nickname}`);
  console.log(`Model     : ${product.type}`);
  console.log(`Verbonden : ${product.status.is_connected}`);
  console.log(`Aanvoer   : ${product.status.supply_temperature}°C`);
  console.log(`Actueel   : ${product.status.actual_temperature}°C`);
  console.log(`Doel      : ${product.status.target_temperature}°C`);
}

main().catch((err) => {
  console.error(err);
});