import { DeWarmteClient } from './src/api/client';
import { AuthService } from './src/api/auth';
import { ProductService } from './src/api/products';

const CHECK_INTERVAL_MS = 30_000;
const PERSISTENCE_TEST_DURATION_MS = 5 * 60_000;

async function createAuthenticatedProductService(
  email: string,
  password: string
): Promise<ProductService> {
  const client = new DeWarmteClient();
  const auth = new AuthService(client);
  const products = new ProductService(client);

  await auth.login(email, password);

  return products;
}

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

  console.log('✅ Inloggen geslaagd');

  console.log('Producten ophalen...');
  const [product] = await products.getProducts();

  if (!product) {
    throw new Error('No DeWarmte product found');
  }

  console.log(`✅ Product gevonden: ${product.id} (${product.nickname})`);

  console.log('Huidige HeatCurveSettings ophalen...');
  const current = await products.getHeatCurveSettings(product.id);
  console.log(JSON.stringify(current, null, 2));

  if (current.heat_curve_s2_target_temp !== 37) {
    throw new Error(
      `Expected S2 target to be 37°C but found ${current.heat_curve_s2_target_temp}°C. Aborting test.`
    );
  }

  console.log('✅ Huidige S2-doeltemperatuur is exact 37°C');

  const original = { ...current };
  const updated = {
    ...original,
    heat_curve_s2_target_temp: 38,
  };
  let firstUpdateAttempted = false;
  let testFailed = false;
  let testError: unknown;

  try {
    console.log('S2-doeltemperatuur wijzigen naar 38°C...');
    firstUpdateAttempted = true;
    await products.updateHeatCurve(product.id, updated);
    console.log('✅ Update naar 38°C verzonden');

    console.log('HeatCurveSettings na update opnieuw ophalen...');
    const afterUpdate = await products.getHeatCurveSettings(product.id);
    console.log(JSON.stringify(afterUpdate, null, 2));

    if (afterUpdate.heat_curve_s2_target_temp !== 38) {
      throw new Error(
        `Expected S2 target to be 38°C but found ${afterUpdate.heat_curve_s2_target_temp}°C.`
      );
    }

    console.log('✅ S2-doeltemperatuur is exact 38°C');

    const startedAt = Date.now();
    const checkCount =
      PERSISTENCE_TEST_DURATION_MS / CHECK_INTERVAL_MS;
    let persistenceError: unknown;

    for (let checkNumber = 1; checkNumber <= checkCount; checkNumber += 1) {
      const checkAt = startedAt + checkNumber * CHECK_INTERVAL_MS;
      const delay = Math.max(0, checkAt - Date.now());
      await new Promise(resolve => setTimeout(resolve, delay));

      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

      try {
        const checkProducts = await createAuthenticatedProductService(
          email,
          password
        );
        const checked = await checkProducts.getHeatCurveSettings(product.id);
        const checkedS2 = checked.heat_curve_s2_target_temp;

        console.log(
          `Controle ${checkNumber} na ${elapsedSeconds} seconden: S2 = ${checkedS2}°C`
        );

        if (checkedS2 !== 38) {
          const error = new Error(
            `Persistence check ${checkNumber} expected S2 target to be 38°C but found ${checkedS2}°C.`
          );
          console.error('❌ Duurzaamheidscontrole mislukt:', error.message);
          persistenceError ??= error;
        }
      } catch (err) {
        console.error(
          `❌ Controle ${checkNumber} na ${elapsedSeconds} seconden mislukt:`,
          err
        );
        persistenceError ??= err;
      }
    }

    if (persistenceError !== undefined) {
      throw persistenceError;
    }
  } catch (err) {
    testFailed = true;
    testError = err;
  } finally {
    if (firstUpdateAttempted) {
      try {
        console.log('Volledige originele HeatCurveSettings terugzetten...');
        await products.updateHeatCurve(product.id, original);
        console.log('✅ Originele instellingen teruggezet');

        console.log(
          'Herstelde HeatCurveSettings met een nieuwe login opnieuw ophalen...'
        );
        const restoreCheckProducts =
          await createAuthenticatedProductService(email, password);
        const restored =
          await restoreCheckProducts.getHeatCurveSettings(product.id);
        console.log(JSON.stringify(restored, null, 2));

        if (restored.heat_curve_s2_target_temp !== 37) {
          throw new Error(
            `Expected restored S2 target to be 37°C but found ${restored.heat_curve_s2_target_temp}°C.`
          );
        }

        console.log('✅ S2-doeltemperatuur is weer exact 37°C');
      } catch (restoreError) {
        if (testFailed) {
          console.error('Failed to restore original HeatCurveSettings:', restoreError);
        } else {
          throw restoreError;
        }
      }
    }
  }

  if (testFailed) {
    throw testError;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
