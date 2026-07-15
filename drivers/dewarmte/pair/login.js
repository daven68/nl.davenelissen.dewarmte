Homey.emit('login', {})
  .then(() => {
    Homey.showView('list_devices');
  });