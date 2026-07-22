'use strict';

const elements = {
  pump: document.getElementById('pump-status'),
  thermostat: document.getElementById('thermostat-status'),
  boiler: document.getElementById('boiler-status'),
  alarm: document.getElementById('alarm-status'),
  supply: document.getElementById('supply-temperature'),
  return: document.getElementById('return-temperature'),
  target: document.getElementById('target-temperature'),
  electrical: document.getElementById('electrical-power'),
  input: document.getElementById('heat-input'),
  output: document.getElementById('heat-output'),
  flow: document.getElementById('water-flow'),
  error: document.getElementById('error-message'),
};

let widgetHomey;
let selectedDeviceId;

function formatNumber(value, decimals, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(decimals)} ${unit}`;
}

function setIndicator(element, active, activeText, inactiveText) {
  element.textContent = active ? activeText : inactiveText;
  element.classList.toggle('active', active === true);
}

function translate(key) {
  return widgetHomey.__(`widget.heatPump.${key}`);
}

function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');

    if (key) {
      element.textContent = translate(key);
    }
  });
}

function render(status) {
  const { values } = status;

  elements.error.hidden = status.available !== false;
  elements.error.textContent = status.available === false
    ? translate('deviceUnavailable')
    : '';

  setIndicator(
    elements.pump,
    values.active,
    translate('heatPumpRunning'),
    translate('heatPumpOff'),
  );
  setIndicator(
    elements.thermostat,
    values.thermostat,
    translate('thermostatActive'),
    translate('thermostat'),
  );
  setIndicator(
    elements.boiler,
    values.gasBoiler,
    translate('gasBoilerOn'),
    translate('gasBoilerOff'),
  );
  elements.alarm.textContent = values.alarm ? translate('fault') : translate('noFault');
  elements.alarm.classList.toggle('fault', values.alarm === true);
  elements.alarm.classList.toggle('healthy', values.alarm === false);
  elements.supply.textContent = formatNumber(values.supplyTemperature, 1, '°C');
  elements.return.textContent = formatNumber(values.returnTemperature, 1, '°C');
  elements.target.textContent = formatNumber(values.targetTemperature, 1, '°C');
  elements.electrical.textContent = formatNumber(values.electricalPower, 0, 'W');
  elements.input.textContent = formatNumber(values.heatInput, 2, 'kW');
  elements.output.textContent = formatNumber(values.heatOutput, 2, 'kW');
  elements.flow.textContent = formatNumber(values.waterFlow, 2, 'L/min');
}

async function refresh() {
  try {
    const status = await widgetHomey.api(
      'GET',
      `/status?deviceId=${encodeURIComponent(selectedDeviceId)}`,
      {},
    );
    render(status);
  } catch (error) {
    elements.error.hidden = !error;
    elements.error.textContent = translate('loadError');
  }
}

window.onHomeyReady = (Homey) => {
  widgetHomey = Homey;
  [selectedDeviceId] = Homey.getDeviceIds();
  translatePage();

  if (!selectedDeviceId) {
    elements.error.hidden = false;
    elements.error.textContent = translate('selectDevice');
    Homey.ready();
    return;
  }

  refresh()
    .then(() => Homey.ready())
    .catch(() => Homey.ready());
  window.setInterval(() => {
    refresh().catch(() => undefined);
  }, 30 * 1000);
};
