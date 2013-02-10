
window.onload = function () {
    document.getElementById('updateLink').addEventListener("click", function(event) {
		chrome.tabs.create({url: chrome.extension.getURL("history.html")});
	});
};