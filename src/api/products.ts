import { DeWarmteClient } from './client';
import {
  HeatCurveSettings,
  OperationSettingsResponse,
  Product,
  ProductListResponse,
} from './types';

export class ProductService {
  constructor(private client: DeWarmteClient) {}

  /**
   * Retourneert alle warmtepompen van de gebruiker.
   */
  async getProducts(): Promise<Product[]> {
    const response =
      await this.client.get<ProductListResponse>('/customer/products/');

    if (response.results.length === 0) {
      throw new Error('No DeWarmte products found');
    }

    return response.results;
  }

  /**
   * Retourneert de eerste warmtepomp.
   * Handig voor testen en backwards compatibility.
   */
  async getProduct(): Promise<Product> {
    const products = await this.getProducts();
    return products[0];
  }

  /**
   * Retourneert de operationele instellingen van een warmtepomp.
   */
  async getOperationSettings(
    productId: string
  ): Promise<OperationSettingsResponse> {
    return this.client.get<OperationSettingsResponse>(
      `/customer/products/${productId}/settings/`
    );
  }

  /**
   * Retourneert uitsluitend de warmtelijninstellingen van een warmtepomp.
   */
  async getHeatCurveSettings(productId: string): Promise<HeatCurveSettings> {
    const settings = await this.getOperationSettings(productId);
    return this.extractHeatCurveSettings(settings);
  }

  /**
   * Werkt de volledige warmtelijngroep van een warmtepomp bij.
   */
  async updateHeatCurve(
    productId: string,
    settings: HeatCurveSettings
  ): Promise<unknown> {
    const body = this.extractHeatCurveSettings(settings);

    return this.client.post<unknown>(
      `/customer/products/${productId}/settings/heat-curve/`,
      body
    );
  }

  private extractHeatCurveSettings(
    settings: HeatCurveSettings
  ): HeatCurveSettings {
    return {
      heat_curve_mode: settings.heat_curve_mode,
      heating_kind: settings.heating_kind,
      heat_curve_s1_outside_temp: settings.heat_curve_s1_outside_temp,
      heat_curve_s1_target_temp: settings.heat_curve_s1_target_temp,
      heat_curve_s2_outside_temp: settings.heat_curve_s2_outside_temp,
      heat_curve_s2_target_temp: settings.heat_curve_s2_target_temp,
      heat_curve_fixed_temperature: settings.heat_curve_fixed_temperature,
      heat_curve_use_smart_correction:
        settings.heat_curve_use_smart_correction,
    };
  }
}
