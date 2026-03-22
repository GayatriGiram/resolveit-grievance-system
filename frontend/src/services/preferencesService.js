const UI_PREFERENCES_KEY = 'resolveit-ui-preferences';

const DEFAULT_UI_PREFERENCES = {
  theme: 'light',
  language: 'en',
};

const allowedThemes = new Set(['light', 'dark']);
const allowedLanguages = new Set(['en', 'hi']);

const normalizePreferences = (value) => {
  const theme = allowedThemes.has(value?.theme) ? value.theme : DEFAULT_UI_PREFERENCES.theme;
  const language = allowedLanguages.has(value?.language) ? value.language : DEFAULT_UI_PREFERENCES.language;

  return {
    theme,
    language,
  };
};

export const getUiPreferences = () => {
  try {
    const stored = localStorage.getItem(UI_PREFERENCES_KEY);
    if (!stored) {
      return { ...DEFAULT_UI_PREFERENCES };
    }
    return normalizePreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
};

export const saveUiPreferences = (next) => {
  const normalized = normalizePreferences(next);
  localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(normalized));
  return normalized;
};

export const updateUiPreferences = (partial) => {
  const current = getUiPreferences();
  return saveUiPreferences({ ...current, ...partial });
};

export { DEFAULT_UI_PREFERENCES, UI_PREFERENCES_KEY };
