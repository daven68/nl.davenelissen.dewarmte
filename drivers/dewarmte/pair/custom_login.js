alert('custom_login.js loaded');

window.onload = function () {

  alert('window.onload');

  const loginButton = document.getElementById('login');

  alert(loginButton ? 'Button found' : 'Button NOT found');

  loginButton.onclick = async function () {

    alert('Login clicked');

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {

      await Homey.emit('login', {
        email,
        password,
      });

      alert('Login successful');

      Homey.showView('list_devices');

    } catch (err) {

      alert(err.message);

    }

  };

};