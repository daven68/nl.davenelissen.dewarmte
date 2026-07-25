'use strict';

let settingsHomey;
let currentReport;

const elements = {
  device: document.getElementById('device'),
  load: document.getElementById('load'),
  reportSection: document.getElementById('report-section'),
  report: document.getElementById('report'),
  copy: document.getElementById('copy'),
  download: document.getElementById('download'),
  message: document.getElementById('message'),
};

function translate(key) {
  return settingsHomey.__(`settings.diagnostics.${key}`);
}

function callApi(method, path) {
  return new Promise((resolve, reject) => {
    settingsHomey.api(method, path, {}, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function showMessage(message, isError = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle('error', isError);
}

function setLoading(loading) {
  elements.device.disabled = loading;
  elements.load.disabled = loading;
  elements.load.textContent = loading ? translate('loading') : translate('load');
}

async function loadDevices() {
  const devices = await callApi('GET', '/diagnostics/devices');
  elements.device.replaceChildren();

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = device.model
      ? `${device.name} (${device.model})`
      : device.name;
    elements.device.appendChild(option);
  });

  if (devices.length === 0) {
    elements.load.disabled = true;
    showMessage(translate('noDevices'), true);
  }
}

async function createReport() {
  if (!elements.device.value) {
    showMessage(translate('noDevices'), true);
    return;
  }

  setLoading(true);
  showMessage('');

  try {
    currentReport = await callApi(
      'GET',
      `/diagnostics/${encodeURIComponent(elements.device.value)}`,
    );
    elements.report.textContent = JSON.stringify(currentReport, null, 2);
    elements.reportSection.hidden = false;
    showMessage(translate('created'));
  } catch (error) {
    currentReport = undefined;
    elements.reportSection.hidden = true;
    showMessage(translate('loadError'), true);
  } finally {
    setLoading(false);
  }
}

async function copyReport() {
  if (!currentReport) {
    return;
  }

  const text = JSON.stringify(currentReport, null, 2);

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  }

  showMessage(translate('copied'));
}

function downloadReport() {
  if (!currentReport) {
    return;
  }

  const model = String(currentReport.productType || 'heat-pump')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const blob = new Blob(
    [JSON.stringify(currentReport, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dewarmte-diagnostics-${model}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showMessage(translate('downloaded'));
}

window.onHomeyReady = async (Homey) => {
  settingsHomey = Homey;
  elements.load.addEventListener('click', () => {
    createReport().catch(() => undefined);
  });
  elements.copy.addEventListener('click', () => {
    copyReport().catch(() => undefined);
  });
  elements.download.addEventListener('click', downloadReport);

  try {
    await loadDevices();
  } catch (error) {
    showMessage(translate('devicesError'), true);
  } finally {
    Homey.ready();
  }
};
