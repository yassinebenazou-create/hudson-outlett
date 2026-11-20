/* ==========================================================================
   HUDSON SHIFT REMINDER — Settings, Theme, PWA Install & Import/Export
   ========================================================================== */

(function (global) {
  'use strict';

  let deferredInstallPrompt = null;
  let onInstallStateChange = null;

  function initPWAInstallListener(callback) {
    onInstallStateChange = callback;

    global.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (typeof onInstallStateChange === 'function') {
        onInstallStateChange(true);
      }
    });

    global.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      if (typeof onInstallStateChange === 'function') {
        onInstallStateChange(false);
      }
    });
  }

  function canPromptInstall() {
    return Boolean(deferredInstallPrompt);
  }

  function isStandaloneMode() {
    return (
      global.matchMedia('(display-mode: standalone)').matches ||
      global.navigator.standalone === true
    );
  }

  async function triggerPWAInstall() {
    if (!deferredInstallPrompt) return { outcome: 'unavailable' };
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (typeof onInstallStateChange === 'function') {
      onInstallStateChange(false);
    }
    return choiceResult;
  }

  function applyTheme(theme) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', normalized);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', normalized === 'dark' ? '#0A192F' : '#0A192F');
    }
  }

  function downloadJSONExport(data) {
    const jsonStr = global.HudsonStorage.exportJSON(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateTag = global.HudsonSchedule.formatDateKey(new Date());
    a.href = url;
    a.download = `hudson-shift-planning-${dateTag}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getPermissionBadgeInfo(status) {
    switch (status) {
      case 'granted':
        return { label: 'Accordées', className: 'badge-success', canRequest: false };
      case 'denied':
        return { label: 'Refusées (navigateur)', className: 'badge-danger', canRequest: false };
      case 'default':
        return { label: 'Non demandées', className: 'badge-warning', canRequest: true };
      default:
        return { label: 'Non supportées', className: 'badge-muted', canRequest: false };
    }
  }

  global.HudsonSettings = {
    initPWAInstallListener,
    canPromptInstall,
    isStandaloneMode,
    triggerPWAInstall,
    applyTheme,
    downloadJSONExport,
    getPermissionBadgeInfo
  };
})(window);
