import { useCallback, useState } from 'react';
import type { AppSettings } from '../types';

const STORAGE_KEY = 'cliptray_app_settings_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  retentionDays: 7,
  gridSize: 'md',
  maxImageDimension: 1920,
  autoOcr: true,
  ocrLanguage: 'jpn+eng',
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    const retentionDays =
      parsed.retentionDays === null ||
      parsed.retentionDays === 1 ||
      parsed.retentionDays === 3 ||
      parsed.retentionDays === 7 ||
      parsed.retentionDays === 30
        ? parsed.retentionDays
        : DEFAULT_SETTINGS.retentionDays;

    const gridSize =
      parsed.gridSize === 'sm' || parsed.gridSize === 'md' || parsed.gridSize === 'lg'
        ? parsed.gridSize
        : DEFAULT_SETTINGS.gridSize;

    const maxImageDimension =
      typeof parsed.maxImageDimension === 'number' &&
      parsed.maxImageDimension >= 640 &&
      parsed.maxImageDimension <= 4096
        ? parsed.maxImageDimension
        : DEFAULT_SETTINGS.maxImageDimension;

    const autoOcr =
      typeof parsed.autoOcr === 'boolean' ? parsed.autoOcr : DEFAULT_SETTINGS.autoOcr;

    const ocrLanguage =
      parsed.ocrLanguage === 'jpn+eng' || parsed.ocrLanguage === 'eng'
        ? parsed.ocrLanguage
        : DEFAULT_SETTINGS.ocrLanguage;

    return {
      retentionDays,
      gridSize,
      maxImageDimension,
      autoOcr,
      ocrLanguage,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(() => loadSettings());

  const updateSettings = useCallback((updater: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => {
    setSettingsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }, []);

  return {
    settings,
    updateSettings,
  };
}
