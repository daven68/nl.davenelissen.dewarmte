export interface ProductStatus {
  time: string;
  is_on: boolean;
  heat_input: number;
  heat_output: number;
  water_flow: number;
  electricity_consumption: number;
  gas_boiler: boolean;
  thermostat: boolean;
  supply_temperature: number;
  actual_temperature: number;
  target_temperature: number;
  fault_code: number;
  electric_backup_usage: number;
  errors: string[];
  is_connected: boolean;
}

export interface Product {
  id: string;
  name: string;
  nickname: string;
  type: string;
  cooling: boolean;
  related_ao: string | null;
  created_at: string;
  status: ProductStatus;
}

export interface ProductListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Product[];
}