import { log, error, generateHashCode, formatHotkeyString } from '../gsUtils';
import { getSessionId } from '../gsSession';
import { getOption, THEME, SCREEN_CAPTURE } from '../gsStorage';
import { browser, Commands } from 'webextension-polyfill-ts';

export type ExtensionState = {
  suspensionToggleHotkey: string;
};

let suspensionToggleHotkey: string;
let settingsStateHash: string;

export const buildSuspensionToggleHotkey = async (): Promise<void> => {
  let _suspensionToggleHotkey = null;
  const commands = await browser.commands.getAll();
  const toggleCommand = commands.find(o => o.name === '1-suspend-tab');
  if (toggleCommand && toggleCommand.shortcut !== '') {
    _suspensionToggleHotkey = formatHotkeyString(toggleCommand.shortcut);
  }
  suspensionToggleHotkey = _suspensionToggleHotkey;
};

export const getSuspensionToggleHotkey = (): string => {
  return suspensionToggleHotkey;
};

export const buildSettingsStateHash = async (): Promise<void> => {
  // Include sessionId in the hash, as the favicon on the suspended page does not get loaded
  // after restart due to it not existing in the tabState for the tab
  const sessionId = getSessionId();
  const theme = getOption(THEME);
  const screenCapture = getOption(SCREEN_CAPTURE);

  const stateString = `${suspensionToggleHotkey}${sessionId}${theme}${screenCapture}`;
  settingsStateHash = `${generateHashCode(stateString)}`;
};

export const getSettingsStateHash = (): string => {
  return settingsStateHash;
};

export const init = async (): Promise<void> => {
  try {
    await buildSuspensionToggleHotkey();
    await buildSettingsStateHash();
    log('extensionState', 'suspensionToggleHotkey: ' + suspensionToggleHotkey);
  } catch (e) {
    error(e);
  }
};
