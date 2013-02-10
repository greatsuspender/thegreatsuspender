/*global window, document, chrome, console, gsStorage */

(function () {

	"use strict";

	var gsSuspended = [];

    function generateSuspendedUrl(tabUrl) {
        return chrome.extension.getURL("suspended.html" + "#url=" + tabUrl);
    }

	window.onload = function () {
		document.getElementById('resuspendLink').addEventListener("click", function (event) {

			var i;
			for (i in gsSuspended) {
				if (gsSuspended.hasOwnProperty(i)) {
					chrome.tabs.create({active: false, url: generateSuspendedUrl(gsSuspended[i].url)});
				}
			}
		});
		document.getElementById('unsuspendLink').addEventListener("click", function (event) {

			var i;
			for (i in gsSuspended) {
				if (gsSuspended.hasOwnProperty(i)) {
					chrome.tabs.create({active: false, url: gsSuspended[i].url});
					gsSuspended[i].state = 'unsuspended';
					gsStorage.saveTabToHistory(gsSuspended[i].url, gsSuspended[i]);
				}
			}
		});
		document.getElementById('historyLink').addEventListener("click", function (event) {
			chrome.tabs.create({url: chrome.extension.getURL("history.html")});
		});


		var gsHistory = gsStorage.fetchGsHistory(),
			openTabs = {},
			suspendedCount = 0;

		chrome.tabs.query({}, function (tabs) {

			var i;
			for (i in tabs) {
				if (tabs.hasOwnProperty(i)) {
					if (tabs[i].url.indexOf('suspended.html') < 0) {
						openTabs[tabs[i].url] = true;
					}
				}
			}

			for (i in gsHistory) {
				if (gsHistory.hasOwnProperty(i)
						&& gsHistory[i].state === 'suspended'
						&& typeof (openTabs[gsHistory[i].url]) === 'undefined') {
					gsSuspended.push(gsHistory[i]);
					suspendedCount++;
				}
			}

			document.getElementById('suspendedCount').innerHTML = suspendedCount;
		});


	};

}());