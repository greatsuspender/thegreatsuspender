# The Great Suspender - Without Analytics Tracking

Modified version of "The Great Suspender" to remove analytics tracking and rogue .js files from anonymous developer who is now in control of the GitHub source & web store versions.

Read more:

[New ownership announcement](https://github.com/greatsuspender/thegreatsuspender/issues/1175)

[New maintainer is probably malicious](https://github.com/greatsuspender/thegreatsuspender/issues/1263)

[Flagged as malware by Microsoft Edge](https://www.windowscentral.com/great-suspender-extension-now-flagged-malware-edge-has-built-replacement)

[Reddit forum discussion](https://old.reddit.com/r/HobbyDrama/comments/jouwq7/open_source_development_the_great_suspender_saga/)

[Medium Article](https://medium.com/nerd-for-tech/malware-in-browser-extensions-3805e8763dd5)

This project is a fork from [v7.1.8 of The Great Suspender](https://github.com/greatsuspender/thegreatsuspender) with all tracking code removed, along with some annoying popups/prompts.

This work carries no guarantees only to the best of my ability in 2 hours using notepad2 & AstroGrep. I am not a developer and do not intend to spend much time keeping this extension updated.

<img src="/src/img/suspendy-guy.png" width="100px" />

"The Great Suspender" is a free and open-source Google Chrome extension for people who find that chrome is consuming too much system resource or suffer from frequent chrome crashing. Once installed and enabled, this extension will automatically *suspend* tabs that have not been used for a while, freeing up memory and cpu that the tab was consuming.

If you have suggestions or problems using the extension, please [submit a pull request](https://github.com/aciidic/thegreatsuspender/issues/). 

**If you have lost tabs from your browser:** The original developer has written a guide for how to recover your lost tabs [here](https://github.com/deanoemcke/thegreatsuspender/issues/526
).

### Chrome Web Store

This version of The Great Suspender is not available on the Chrome Web Store.


### You should install this extension from source

1. Download the **[latest available version](https://github.com/aciidic/thegreatsuspender/releases)** and unarchive to your preferred location (whichever suits you).
2. Using **Google Chrome** browser, navigate to chrome://extensions/ and enable "Developer mode" in the upper right corner.
3. Click on the <kbd>Load unpacked extension...</kbd> button.
4. Browse to the src directory of the unarchived folder and confirm.

If you have completed the above steps, the "welcome" page will open indicating successful installation of the extension.

Be sure to unsuspend all suspended tabs before removing any other version of the extension or they will disappear forever!

### Build from github (untested in this release)

Dependencies: openssl, npm.

Clone the repository and run these commands:
```
npm install
npm run generate-key
npm run build
```

It should say:
```
Done, without errors.
```

The extension in crx format will be inside the build/crx/ directory. You can drag it into [extensions] (chrome://extensions) to install locally.

### Integrating with another Chrome extension or app

The old extension had a small external api to allow other extensions to request the suspension of a tab. See [this issue](https://github.com/greatsuspender/thegreatsuspender/issues/276) for more information.

### Windows Group Policies / Windows Registry configuration values

Since extension version 7.1.8 it is possible to set the configuration using the system registy, which can be applied via group policies on Microsoft Windows.
[More Info](https://github.com/greatsuspender/thegreatsuspender/issues/1174)

The whitelist consists of a list of domains seperated by a space character, *do not include http:// or https://* Here's an example:
  `domain1.com www.domain2.com sub.domain3.com`

Configuration stored in registry can be either HKCU or HKLM at 
  `\Software\Policies\Google\Chrome\3rdparty\extensions\EXTENSION_ID\policy`

Replace the EXTENSION_ID with the correct value

- To enable function use REG_DWORD set to 1
- To disable function use REG_DWORD set to 0
- When using REG_SZ "quotes" are not required

*The following settings can be defined:*

* `SCREEN_CAPTURE` (string, default: '0')
* `SCREEN_CAPTURE_FORCE` (boolean, default: false)
* `SUSPEND_IN_PLACE_OF_DISCARD` (boolean, default: false)
* `DISCARD_IN_PLACE_OF_SUSPEND` (boolean, default: false)
* `USE_ALT_SCREEN_CAPTURE_LIB` (boolean, default: false)
* `DISCARD_AFTER_SUSPEND` (boolean, default: false)
* `IGNORE_WHEN_OFFLINE` (boolean, default: false)
* `IGNORE_WHEN_CHARGING` (boolean, default: false)
* `UNSUSPEND_ON_FOCUS` (boolean, default: false)
* `IGNORE_PINNED` (boolean, default: true)
* `IGNORE_FORMS` (boolean, default: true)
* `IGNORE_AUDIO` (boolean, default: true)
* `IGNORE_ACTIVE_TABS` (boolean, default: true)
* `IGNORE_CACHE` (boolean, default: false)
* `ADD_CONTEXT` (boolean, default: true)
* `SYNC_SETTINGS` (boolean, default: true)
* `ENABLE_CLEAN_SCREENCAPS` (boolean, default: false)
* `SUSPEND_TIME` (string (minutes), default: '60')
* `NO_NAG` (boolean, default: false)
* `WHITELIST` (string (one URL per line), default: '')
* `THEME` (string, default: 'light')


**Step by Step:**

*Note that config changes don't seem to apply until Chrome is restarted, sometimes requires closing/re-opening chrome for a second time*

1. Copy the extension ID from chrome://extensions
2. Create required registry keys (pick either HKLM or HKCU) obviously add your own extension ID, at:
`\Software\Policies\Google\Chrome\3rdparty\extensions\EXTENSION_ID\policy`
  - Use REG_SZ for string config values
  - Use REG_DWORD for boolean config (1 for true, 0 for false)
  - Use REG_SZ for WHITELIST, split each domain with a space char. Extension doesn't care for www.  but do not include http/s://
    `domain1.com domain2.com www.domain3.com whatever.you.want.com`
3. **Restart Chrome at least once, if not twice**
4. Go to chrome://policy and click "Reload policies" in top left, you should see your configuration listed
![Config Example](https://i.imgur.com/Vr6P7xp.png)


### Contributing to this extension

Contributions are very welcome. Feel free to submit pull requests for new features and bug fixes. For new features, ideally you would raise an issue for the proposed change first so that we can discuss ideas. This will go a long way to ensuring your pull request is accepted.

### License

This work is licensed under a GNU GENERAL PUBLIC LICENSE (v2)

### Shoutouts

This package uses the [html2canvas](https://github.com/niklasvh/html2canvas) library written by Niklas von Hertzen.
It also uses the indexedDb wrapper [db.js](https://github.com/aaronpowell/db.js) written by Aaron Powell.
Thank you also to [BrowserStack](https://www.browserstack.com) for providing free chrome testing tools.
Original source from [The Great Suspender v7.1.8](https://github.com/greatsuspender/thegreatsuspender)
