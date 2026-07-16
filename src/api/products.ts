import { DeWarmteClient } from './client';
import { Product, ProductListResponse } from './types';

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
}