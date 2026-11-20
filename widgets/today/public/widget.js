'use strict';

const copElement = document.getElementById('cop-today');
const titleElement = document.getElementById('title');
const errorElement = document.getElementById('error-message');

let widgetHomey;
let selectedDeviceId;
let period = 'day';

function translate(key) {
  return widgetHomey.__(`widget.today.${key}`);
}

function render(status) {
  const { cop } = status;
  copElement.textContent = typeof cop === 'number' && Number.isFinite(cop)
    ? cop.toFixed(1)
    : '--';

  errorElement.hidden = status.available !== false;
  errorElement.textContent = status.available === false
    ? translate('deviceUnavailable')
    : '';
}

async function refresh() {
  try {
    const status = await widgetHomey.api(
      'GET',
      `/cop?deviceId=${encodeURIComponent(selectedDeviceId)}`
        + `&period=${encodeURIComponent(period)}`,
      {},
    );
    render(status);
  } catch (error) {
    errorElement.hidden = !error;
    errorElement.textContent = translate('loadError');
  }
}

window.onHomeyReady = (Homey) => {
  widgetHomey = Homey;
  [selectedDeviceId] = Homey.getDeviceIds();
  period = (Homey.getSettings() || {}).period || 'day';
  titleElement.textContent = translate(period);

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = translate(element.getAttribute('data-i18n'));
  });

  if (!selectedDeviceId) {
    errorElement.hidden = false;
    errorElement.textContent = translate('selectDevice');
    Homey.ready();
    return;
  }

  refresh()
    .then(() => Homey.ready())
    .catch(() => Homey.ready());
  window.setInterval(() => {
    refresh().catch(() => undefined);
  }, 60 * 1000);
};
