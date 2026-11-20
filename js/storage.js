/* ==========================================================================
   HUDSON SHIFT REMINDER — LocalStorage Data Management
   All data stays 100% local on the employee's device.
   ========================================================================== */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'hudson_shift_data_v1';

  const DEFAULT_SCHEDULE = {
    1: { enabled: true, start: '08:00', end: '16:00', breakMinutes: 60 },  // Lundi
    2: { enabled: true, start: '08:00', end: '16:00', breakMinutes: 60 },  // Mardi
    3: { enabled: true, start: '14:00', end: '22:00', breakMinutes: 45 },  // Mercredi
    4: { enabled: false, start: '08:00', end: '16:00', breakMinutes: 60 }, // Jeudi (Repos)
    5: { enabled: true, start: '08:00', end: '16:00', breakMinutes: 60 },  // Vendredi
    6: { enabled: true, start: '08:00', end: '16:00', breakMinutes: 60 },  // Samedi
    0: { enabled: false, start: '08:00', end: '16:00', breakMinutes: 60 }  // Dimanche (Repos)
  };

  function generateDeviceId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getDefaultData() {
    return {
      version: 1,
      deviceId: generateDeviceId(),
      employeeName: '',
      profilePhoto: '',
      onboardingDone: false,
      theme: 'light',
      language: 'fr',
      weekStartsOnMonday: true,
      repeatWeekly: true,
      schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
      reminders: {
        startEnabled: true,
        startOffsets: { 30: true, 15: true, 5: true, 0: true },
        startSound: 'bell',
        startRepeat: false,
        endEnabled: true,
        endOffsets: { 15: true, 5: true, 0: true },
        endSound: 'alarm',
        endRepeat: false,
        soundVolume: 0.8
      },
      confirmations: {},
      firedReminders: {},
      snoozedUntil: {}
    };
  }

  function mergeWithDefaults(parsed) {
    const defaults = getDefaultData();
    if (!parsed || typeof parsed !== 'object') return defaults;

    const mergedSchedule = {};
    for (let d = 0; d <= 6; d++) {
      const src = parsed.schedule && parsed.schedule[d] ? parsed.schedule[d] : defaults.schedule[d];
      mergedSchedule[d] = {
        enabled: Boolean(src.enabled),
        start: typeof src.start === 'string' && /^\d{2}:\d{2}$/.test(src.start) ? src.start : defaults.schedule[d].start,
        end: typeof src.end === 'string' && /^\d{2}:\d{2}$/.test(src.end) ? src.end : defaults.schedule[d].end,
        breakMinutes: Number.isFinite(Number(src.breakMinutes)) ? Math.max(0, Number(src.breakMinutes)) : 0
      };
    }

    const r = parsed.reminders || {};
    const defR = defaults.reminders;

    return {
      version: 1,
      deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId ? parsed.deviceId : generateDeviceId(),
      employeeName: typeof parsed.employeeName === 'string' ? parsed.employeeName : '',
      profilePhoto: typeof parsed.profilePhoto === 'string' ? parsed.profilePhoto : '',
      onboardingDone: Boolean(parsed.onboardingDone),
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      language: 'fr',
      weekStartsOnMonday: parsed.weekStartsOnMonday !== undefined ? Boolean(parsed.weekStartsOnMonday) : true,
      repeatWeekly: parsed.repeatWeekly !== undefined ? Boolean(parsed.repeatWeekly) : true,
      schedule: mergedSchedule,
      reminders: {
        startEnabled: r.startEnabled !== undefined ? Boolean(r.startEnabled) : defR.startEnabled,
        startOffsets: { ...defR.startOffsets, ...(r.startOffsets || {}) },
        startSound: typeof r.startSound === 'string' ? r.startSound : defR.startSound,
        startRepeat: Boolean(r.startRepeat),
        endEnabled: r.endEnabled !== undefined ? Boolean(r.endEnabled) : defR.endEnabled,
        endOffsets: { ...defR.endOffsets, ...(r.endOffsets || {}) },
        endSound: typeof r.endSound === 'string' ? r.endSound : defR.endSound,
        endRepeat: Boolean(r.endRepeat),
        soundVolume: Number.isFinite(Number(r.soundVolume)) ? Math.min(1, Math.max(0, Number(r.soundVolume))) : defR.soundVolume
      },
      confirmations: parsed.confirmations && typeof parsed.confirmations === 'object' ? parsed.confirmations : {},
      firedReminders: parsed.firedReminders && typeof parsed.firedReminders === 'object' ? parsed.firedReminders : {},
      snoozedUntil: parsed.snoozedUntil && typeof parsed.snoozedUntil === 'object' ? parsed.snoozedUntil : {}
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultData();
      const parsed = JSON.parse(raw);
      return mergeWithDefaults(parsed);
    } catch (err) {
      console.error('Erreur lors du chargement LocalStorage:', err);
      return getDefaultData();
    }
  }

  function save(data) {
    try {
      pruneOldRecords(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('Erreur lors de la sauvegarde LocalStorage:', err);
      return false;
    }
  }

  function pruneOldRecords(data) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (data.firedReminders) {
      for (const key of Object.keys(data.firedReminders)) {
        if (data.firedReminders[key] < cutoff) {
          delete data.firedReminders[key];
        }
      }
    }
    if (data.snoozedUntil) {
      for (const key of Object.keys(data.snoozedUntil)) {
        if (data.snoozedUntil[key] < Date.now() - 24 * 60 * 60 * 1000) {
          delete data.snoozedUntil[key];
        }
      }
    }
  }

  function resetSchedule(data) {
    data.schedule = JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));
    save(data);
    return data;
  }

  function clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('Erreur lors de la suppression LocalStorage:', err);
    }
    return getDefaultData();
  }

  function exportJSON(data) {
    const payload = {
      app: 'HUDSON SHIFT',
      exportedAt: new Date().toISOString(),
      employeeName: data.employeeName,
      weekStartsOnMonday: data.weekStartsOnMonday,
      repeatWeekly: data.repeatWeekly,
      theme: data.theme,
      schedule: data.schedule,
      reminders: data.reminders
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(jsonString, currentData) {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || !parsed.schedule) {
      throw new Error('Format JSON invalide : planning introuvable.');
    }
    const next = mergeWithDefaults({
      ...currentData,
      employeeName: typeof parsed.employeeName === 'string' ? parsed.employeeName : currentData.employeeName,
      weekStartsOnMonday: parsed.weekStartsOnMonday !== undefined ? parsed.weekStartsOnMonday : currentData.weekStartsOnMonday,
      repeatWeekly: parsed.repeatWeekly !== undefined ? parsed.repeatWeekly : currentData.repeatWeekly,
      theme: parsed.theme || currentData.theme,
      schedule: parsed.schedule,
      reminders: parsed.reminders || currentData.reminders,
      onboardingDone: true
    });
    save(next);
    return next;
  }

  global.HudsonStorage = {
    STORAGE_KEY,
    getDefaultData,
    load,
    save,
    resetSchedule,
    clearAll,
    exportJSON,
    importJSON
  };
})(window);
