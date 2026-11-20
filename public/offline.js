// Offline page helper (served with /offline.html from the service worker cache): go back to Jalebi Games as soon as the
// network is back. If the browser says it is online but the page still failed to load (server down), retry a few
// times with growing pauses, then stop: the "Try again" button is always there.
(function () {
  var KEY = 'hub.offline.tries';
  var DELAYS = [4000, 12000, 30000];

  function go() {
    window.location.replace('/');
  }
  function tries() {
    try {
      return Number(sessionStorage.getItem(KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }
  function setTries(n) {
    try {
      sessionStorage.setItem(KEY, String(n));
    } catch (e) {
      /* ignore */
    }
  }

  window.addEventListener('online', function () {
    setTries(0);
    go();
  });

  var n = tries();
  if (navigator.onLine && n < DELAYS.length) {
    setTimeout(function () {
      setTries(n + 1);
      go();
    }, DELAYS[n]);
  }
})();
