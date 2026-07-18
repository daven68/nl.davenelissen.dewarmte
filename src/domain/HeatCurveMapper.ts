import { HeatCurveSettings } from '../api/types';
import { HeatCurve } from './HeatCurve';

export function heatCurveSettingsToHeatCurve(
  settings: HeatCurveSettings,
): HeatCurve {
  return {
    mode: settings.heat_curve_mode,
    heatingKind: settings.heating_kind,
    setpoint1: {
      outsideTemperature: settings.heat_curve_s1_outside_temp,
      targetTemperature: settings.heat_curve_s1_target_temp,
    },
    setpoint2: {
      outsideTemperature: settings.heat_curve_s2_outside_temp,
      targetTemperature: settings.heat_curve_s2_target_temp,
    },
    fixedTemperature: settings.heat_curve_fixed_temperature,
    smartCorrection: settings.heat_curve_use_smart_correction,
  };
}

export function heatCurveToHeatCurveSettings(
  heatCurve: HeatCurve,
): HeatCurveSettings {
  return {
    heat_curve_mode: heatCurve.mode,
    heating_kind: heatCurve.heatingKind,
    heat_curve_s1_outside_temp: heatCurve.setpoint1.outsideTemperature,
    heat_curve_s1_target_temp: heatCurve.setpoint1.targetTemperature,
    heat_curve_s2_outside_temp: heatCurve.setpoint2.outsideTemperature,
    heat_curve_s2_target_temp: heatCurve.setpoint2.targetTemperature,
    heat_curve_fixed_temperature: heatCurve.fixedTemperature,
    heat_curve_use_smart_correction: heatCurve.smartCorrection,
  };
}
