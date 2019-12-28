let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const { getOption, setOptionAndSync, NO_NAG } = gsGlobals.gsStorage;
const { reportEvent, reportPageView } = gsGlobals.gsAnalytics;
const { documentReadyAndLocalisedAsPromsied } = gsGlobals.gsUtils;

function toggleNag(hideNag) {
  setOptionAndSync(NO_NAG, hideNag);
  reportEvent('Donations', 'HidePopupManual', hideNag);
}

function loadDonateButtons(responseText) {
  document.getElementById('donateButtons').innerHTML = responseText;

  const bitcoinBtn = document.getElementById('bitcoinBtn');
  const patreonBtn = document.getElementById('patreonBtn');
  const paypalBtn = document.getElementById('paypalBtn');

  bitcoinBtn.innerHTML = chrome.i18n.getMessage('js_donate_bitcoin');
  patreonBtn.innerHTML = chrome.i18n.getMessage('js_donate_patreon');
  paypalBtn.setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));

  bitcoinBtn.onclick = function() {
    reportEvent('Donations', 'Click', 'coinbase');
  };
  patreonBtn.onclick = function() {
    reportEvent('Donations', 'Click', 'patreon');
  };
  paypalBtn.onclick = function() {
    reportEvent('Donations', 'Click', 'paypal');
  };

  document.getElementById('alreadyDonatedToggle').onclick = function() {
    toggleNag(true);
    window.location.reload();
  };
  document.getElementById('donateAgainToggle').onclick = function() {
    toggleNag(false);
    window.location.reload();
  };
}

documentReadyAndLocalisedAsPromsied(document).then(function() {
  const versionEl = document.getElementById('aboutVersion');
  versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

  if (getOption(NO_NAG)) {
    document.getElementById('donateSection').style.display = 'none';
    document.getElementById('donatedSection').style.display = 'block';
  }

  const request = new XMLHttpRequest();
  request.onload = () => loadDonateButtons(request.responseText);
  request.open('GET', 'support.html', true);
  request.send();

  //hide incompatible sidebar items if in incognito mode
  if (chrome.extension.inIncognitoContext) {
    Array.prototype.forEach.call(
      document.getElementsByClassName('noIncognito'),
      function(el) {
        el.style.display = 'none';
      }
    );
  }
});

reportPageView('about.html');
