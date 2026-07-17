export interface HeatCurve {
  mode: string;
  heatingKind: string;
  setpoint1: {
    outsideTemperature: number;
    targetTemperature: number;
  };
  setpoint2: {
    outsideTemperature: number;
    targetTemperature: number;
  };
  fixedTemperature: number;
  smartCorrection: boolean;
}
