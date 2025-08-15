import { useEffect } from 'react';

const SETTINGS_KEY = 'aux-wars-settings';

/**
 * Custom hook to persist game settings to localStorage
 * @param {Object} settings - Current settings object
 * @returns {Object} Saved settings or defaults
 */
export function useSettingsPersistence(settings) {
  // Save settings whenever they change
  useEffect(() => {
    if (settings && settings.numberOfRounds && settings.selectedPrompts) {
      const settingsToSave = {
        numberOfRounds: settings.numberOfRounds,
        selectedPrompts: settings.selectedPrompts,
        // Don't save roundLength as it's not currently used
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsToSave));
    }
  }, [settings]);
}

/**
 * Get saved settings from localStorage
 * @returns {Object|null} Saved settings or null
 */
export function getSavedSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    // Storage not available - return null
  }
  return null;
}

/**
 * Clear saved settings
 */
export function clearSavedSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}