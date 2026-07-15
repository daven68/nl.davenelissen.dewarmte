import { DeWarmteClient } from './client';
import { Product, ProductListResponse } from './types';

export class ProductService {
  constructor(private client: DeWarmteClient) {}

  async getProduct(): Promise<Product> {
    const response =
      await this.client.get<ProductListResponse>('/customer/products/');

    if (response.results.length === 0) {
      throw new Error('No DeWarmte product found');
    }

    return response.results[0];
  }
}