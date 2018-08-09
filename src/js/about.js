/* global chrome, XMLHttpRequest */
(function() {
  'use strict';

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  function toggleNag(hideNag) {
    gsStorage.setOption(gsStorage.NO_NAG, hideNag);
  }

  function loadDonateButtons() {
    document.getElementById('donateButtons').innerHTML = this.responseText;

    var bitcoinBtn = document.getElementById('bitcoinBtn');
    var patreonBtn = document.getElementById('patreonBtn');
    var paypalBtn = document.getElementById('paypalBtn');

    bitcoinBtn.innerHTML = chrome.i18n.getMessage('js_donate_bitcoin');
    patreonBtn.innerHTML = chrome.i18n.getMessage('js_donate_patreon');
    paypalBtn.setAttribute('value', chrome.i18n.getMessage('js_donate_paypal'));

    bitcoinBtn.onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'coinbase');
    };
    patreonBtn.onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'patreon');
    };
    paypalBtn.onclick = function() {
      gsAnalytics.reportEvent('Donations', 'Click', 'paypal');
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

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var versionEl = document.getElementById('aboutVersion');
    versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

    if (gsStorage.getOption(gsStorage.NO_NAG)) {
      document.getElementById('donateSection').style.display = 'none';
      document.getElementById('donatedSection').style.display = 'block';
    }

    var request = new XMLHttpRequest();
    request.onload = loadDonateButtons;
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

  gsAnalytics.reportPageView('about.html');
})();
