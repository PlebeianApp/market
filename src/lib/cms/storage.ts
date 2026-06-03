import type { Data, Config } from '@puckeditor/core';

const STORAGE_KEY = 'plebeian-market-puck-draft';

/**
 * Saves the current Puck data to localStorage.
 * Returns true on success, throws on failure.
 */
export const saveDraft = (data: Data): boolean => {
  try {
    const serialized = JSON.stringify(data);
    localStorage.setItem(STORAGE_KEY, serialized);
    console.log('✅ Draft saved to localStorage');
    return true;
  } catch (error) {
    console.error('❌ Failed to save draft:', error);
    throw new Error('Could not save draft to browser storage');
  }
};

/**
 * Loads the saved Puck data from localStorage.
 * Returns the data object if found, or null if no draft exists.
 */
export const loadDraft = (): Data | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored) as Data;
    console.log('✅ Draft loaded from localStorage');
    return parsed;
  } catch (error) {
    console.error('❌ Failed to load draft:', error);
    // If corrupted, clear it to prevent infinite loop of errors
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

/**
 * Clears the current draft from localStorage.
 */
export const clearDraft = (): void => {
  localStorage.removeItem(STORAGE_KEY);
  console.log('🗑️ Draft cleared');
};