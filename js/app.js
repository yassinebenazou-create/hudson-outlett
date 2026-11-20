/* ==========================================================================
   HUDSON SHIFT REMINDER — Main Application Controller
   ========================================================================== */

(function (global) {
  'use strict';

  const Storage = global.HudsonStorage;
  const Schedule = global.HudsonSchedule;
  const Reminders = global.HudsonReminders;
  const Settings = global.HudsonSettings;

  let appData = Storage.load();
  let currentView = 'accueil';
  let editingDayIndex = null;
  let activeAlert = null;
  let confirmCallback = null;
  let tickerId = null;

  // ========================================================================
  // DOM HELPERS & TOASTS
  // ========================================================================
  const $ = (id) => document.getElementById(id);

  function showToast(message, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function openConfirmDialog({ title, message, okLabel = 'Confirmer', okOnly = false, onConfirm }) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('btn-confirm-ok').textContent = okLabel;
    $('btn-confirm-cancel').classList.toggle('hidden', okOnly);
    confirmCallback = onConfirm || null;
    $('confirm-dialog').classList.remove('hidden');
  }

  function closeConfirmDialog() {
    $('confirm-dialog').classList.add('hidden');
    confirmCallback = null;
  }

  // ========================================================================
  // NAVIGATION & INITIALIZATION
  // ========================================================================
  function switchView(viewName) {
    currentView = viewName;
    $('app-header').classList.toggle('hidden', viewName === 'accueil' || viewName === 'parametres');
    document.querySelectorAll('.view').forEach((el) => {
      el.classList.toggle('active', el.id === `view-${viewName}`);
    });
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === viewName);
    });

    if (viewName === 'accueil') renderDashboard();
    if (viewName === 'planning') renderPlanning();
    if (viewName === 'rappels') renderRemindersView();
    if (viewName === 'parametres') renderSettingsView();
  }

  function showAppShell() {
    $('onboarding-screen').classList.add('hidden');
    $('app-shell').classList.remove('hidden');
    renderDashboard();
    renderPlanning();
    renderRemindersView();
    renderSettingsView();
    startClockTicker();
    Reminders.startEngine(() => appData, showReminderAlertModal);
  }

  function showOnboarding() {
    $('app-shell').classList.add('hidden');
    $('onboarding-screen').classList.remove('hidden');
  }

  // ========================================================================
  // DASHBOARD (ACCUEIL)
  // ========================================================================
  function renderDashboard() {
    const now = new Date();
    const firstName = (appData.employeeName || '').trim();
    $('greeting-title').textContent = firstName ? `Bonjour ${firstName} 👋` : 'Bonjour 👋';
    $('header-date').textContent = Schedule.formatFrenchDate(now);

    const dashAvatar = $('dash-avatar-img');
    if (dashAvatar) {
      if (appData.profilePhoto) {
        dashAvatar.src = appData.profilePhoto;
        dashAvatar.classList.remove('hidden');
      } else {
        dashAvatar.classList.add('hidden');
      }
    }

    const state = Schedule.getDashboardState(appData, now);
    const { focusShift, focusConfirmation, status, todayShift, isTodayRest } = state;

    const badgeEl = $('shift-status-badge');
    badgeEl.textContent = status.label;
    badgeEl.className = `badge ${status.badgeClass}`;

    if (!focusShift) {
      $('hero-shift-content').classList.add('hidden');
      $('hero-actions').classList.add('hidden');
      $('hero-empty-state').classList.remove('hidden');
    } else {
      $('hero-empty-state').classList.add('hidden');
      $('hero-shift-content').classList.remove('hidden');
      $('hero-actions').classList.remove('hidden');

      const todayKey = Schedule.formatDateKey(now);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const tomorrowKey = Schedule.formatDateKey(tomorrow);

      let dayLabel = focusShift.dayName;
      if (focusShift.dateKey === todayKey) dayLabel = "Aujourd'hui";
      else if (focusShift.dateKey === tomorrowKey) dayLabel = 'Demain';

      $('hero-card-heading').textContent =
        focusShift.dateKey === todayKey ? "Shift d'aujourd'hui" : 'Prochain Shift';
      $('hero-shift-day').textContent = `${dayLabel}${focusShift.crossesMidnight ? ' (Nuit)' : ''}`;
      $('hero-shift-hours').textContent = `${focusShift.startTime} → ${focusShift.endTime}`;

      $('hero-countdown').textContent =
        status.countdownMs > 0 ? Schedule.formatCountdown(status.countdownMs) : '00:00:00';
      $('hero-countdown-label').textContent = status.countdownLabel;

      const btnStart = $('btn-confirm-start');
      const btnEnd = $('btn-confirm-end');

      const isStarted = Boolean(focusConfirmation.startedAt);
      const isFinished = Boolean(focusConfirmation.finishedAt);

      btnStart.disabled = isStarted || isFinished;
      btnEnd.disabled = !isStarted || isFinished;

      btnStart.querySelector('span').textContent = isStarted
        ? 'Shift démarré ✓'
        : "J'ai démarré mon shift";
      btnEnd.querySelector('span').textContent = isFinished
        ? 'Shift terminé ✓'
        : "J'ai terminé mon shift";

      const tsBox = $('confirmation-timestamps');
      const lines = [];
      if (focusConfirmation.startedAt) {
        lines.push(`Début confirmé à ${Schedule.formatTimeShort(new Date(focusConfirmation.startedAt))}`);
      }
      if (focusConfirmation.finishedAt) {
        lines.push(`Fin confirmée à ${Schedule.formatTimeShort(new Date(focusConfirmation.finishedAt))}`);
      }
      if (Number.isFinite(focusConfirmation.actualDurationMinutes)) {
        lines.push(`Durée réelle : ${Schedule.formatDuration(focusConfirmation.actualDurationMinutes)}`);
      }
      if (lines.length > 0) {
        tsBox.innerHTML = lines.map((l) => `<div>• ${l}</div>`).join('');
        tsBox.classList.remove('hidden');
      } else {
        tsBox.classList.add('hidden');
      }
    }

    // Today's Schedule Card
    const workPill = $('today-work-pill');
    if (isTodayRest || !todayShift) {
      workPill.textContent = 'Jour de repos';
      workPill.className = 'pill pill-rest';
      $('today-schedule-details').classList.add('hidden');
      $('today-rest-state').classList.remove('hidden');
    } else {
      workPill.textContent = 'Jour travaillé';
      workPill.className = 'pill pill-work';
      $('today-rest-state').classList.add('hidden');
      $('today-schedule-details').classList.remove('hidden');
      $('today-start').textContent = todayShift.startTime;
      $('today-end').textContent = todayShift.endTime + (todayShift.crossesMidnight ? ' (+1j)' : '');
      $('today-break').textContent =
        todayShift.breakMinutes > 0 ? Schedule.formatDuration(todayShift.breakMinutes) : 'Aucune';
      $('today-duration').textContent = Schedule.formatDuration(todayShift.netMinutes);
    }
  }

  function confirmShiftAction(type, shiftObj) {
    const state = Schedule.getDashboardState(appData, new Date());
    const targetShift = shiftObj || state.focusShift;
    if (!targetShift) return;

    if (!appData.confirmations) appData.confirmations = {};
    const existing = appData.confirmations[targetShift.shiftId] || {};
    const now = new Date();
    const nowIso = now.toISOString();

    if (type === 'start') {
      if (existing.startedAt) return;
      existing.startedAt = nowIso;
      showToast('Début de shift confirmé ! Pensez au système Hudson.', 'success');
    } else if (type === 'end') {
      if (!existing.startedAt) {
        showToast("Vous devez d'abord démarrer votre shift.", 'error');
        return;
      }
      if (existing.finishedAt) return;
      existing.finishedAt = nowIso;
      const diffMs = Math.max(0, now.getTime() - new Date(existing.startedAt).getTime());
      existing.actualDurationMinutes = Math.round(diffMs / 60000);
      showToast(
        `Fin confirmée (${Schedule.formatDuration(existing.actualDurationMinutes)}) ! Pensez au système Hudson.`,
        'success'
      );
    }

    appData.confirmations[targetShift.shiftId] = existing;
    Storage.save(appData);
    renderDashboard();
    if (currentView === 'planning') renderPlanning();
  }

  function startClockTicker() {
    if (tickerId) clearInterval(tickerId);
    tickerId = setInterval(() => {
      if (currentView === 'accueil') {
        renderDashboard();
      }
    }, 1000);
  }

  // ========================================================================
  // WEEKLY SCHEDULE (MON PLANNING)
  // ========================================================================
  function renderPlanning() {
    $('toggle-repeat-weekly').checked = Boolean(appData.repeatWeekly);

    const summary = Schedule.getWeeklySummary(appData.schedule);
    $('summary-total-hours').textContent = summary.formattedHours;
    $('summary-work-days').textContent = String(summary.workingDays);
    $('summary-rest-days').textContent = String(summary.restDays);

    const listEl = $('weekly-schedule-list');
    listEl.innerHTML = '';

    const orderedDays = Schedule.getOrderedDays(appData.weekStartsOnMonday);
    const todayIndex = new Date().getDay();

    orderedDays.forEach((dayIdx) => {
      const cfg = appData.schedule[dayIdx];
      const dayName = Schedule.DAY_NAMES_FR[dayIdx];
      const isToday = dayIdx === todayIndex;

      const row = document.createElement('div');
      row.className = `schedule-day-row ${isToday ? 'is-today' : ''}`;

      const info = document.createElement('div');
      info.className = 'schedule-day-info';
      info.addEventListener('click', () => openDayEditor(dayIdx));

      const nameEl = document.createElement('div');
      nameEl.className = 'schedule-day-name';
      nameEl.innerHTML = `${dayName}${isToday ? ' <span class="today-dot" title="Aujourd\'hui"></span>' : ''}`;

      const hoursEl = document.createElement('div');
      if (cfg.enabled) {
        const breakText = cfg.breakMinutes > 0 ? ` • Pause ${Schedule.formatDuration(cfg.breakMinutes)}` : '';
        hoursEl.className = 'schedule-day-hours';
        hoursEl.textContent = `${cfg.start} – ${cfg.end}${breakText}`;
      } else {
        hoursEl.className = 'schedule-day-hours is-rest';
        hoursEl.textContent = 'Repos';
      }

      info.appendChild(nameEl);
      info.appendChild(hoursEl);

      const actions = document.createElement('div');
      actions.className = 'schedule-day-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary btn-xs';
      editBtn.textContent = 'Modifier';
      editBtn.addEventListener('click', () => openDayEditor(dayIdx));

      const switchWrap = document.createElement('label');
      switchWrap.className = 'switch-wrap';
      switchWrap.setAttribute('aria-label', `Activer ${dayName}`);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'switch-input';
      checkbox.checked = cfg.enabled;
      checkbox.addEventListener('change', () => {
        appData.schedule[dayIdx].enabled = checkbox.checked;
        Storage.save(appData);
        renderPlanning();
        renderDashboard();
        showToast(
          `${dayName} : ${checkbox.checked ? 'jour travaillé' : 'jour de repos'}`,
          'success'
        );
      });

      const slider = document.createElement('span');
      slider.className = 'switch-slider';

      switchWrap.appendChild(checkbox);
      switchWrap.appendChild(slider);

      actions.appendChild(editBtn);
      actions.appendChild(switchWrap);

      row.appendChild(info);
      row.appendChild(actions);
      listEl.appendChild(row);
    });

    renderConfirmationHistory();
  }

  function renderConfirmationHistory() {
    const container = $('shift-history-list');
    if (!container) return;
    const entries = Object.entries(appData.confirmations || {})
      .filter(([, val]) => val && (val.startedAt || val.finishedAt))
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 7);

    if (entries.length === 0) {
      container.innerHTML = '<p class="muted-text">Aucune confirmation enregistrée pour le moment.</p>';
      return;
    }

    container.innerHTML = '';
    entries.forEach(([dateKey, conf]) => {
      const [y, m, d] = dateKey.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const item = document.createElement('div');
      item.className = 'history-item';

      const startStr = conf.startedAt ? Schedule.formatTimeShort(new Date(conf.startedAt)) : '—';
      const endStr = conf.finishedAt ? Schedule.formatTimeShort(new Date(conf.finishedAt)) : '—';

      item.innerHTML = `
        <div>
          <div class="history-date">${Schedule.formatFrenchDate(dateObj)}</div>
          <div class="history-times">Début : ${startStr} • Fin : ${endStr}</div>
        </div>
        <span class="badge ${conf.finishedAt ? 'badge-success' : 'badge-active'}">
          ${conf.finishedAt ? 'Terminé' : 'En cours'}
        </span>
      `;
      container.appendChild(item);
    });
  }

  function openDayEditor(dayIdx) {
    editingDayIndex = dayIdx;
    const cfg = appData.schedule[dayIdx];
    $('editor-day-name').textContent = Schedule.DAY_NAMES_FR[dayIdx];
    $('editor-enabled').checked = cfg.enabled;
    $('editor-start').value = cfg.start;
    $('editor-end').value = cfg.end;
    $('editor-break').value = String(cfg.breakMinutes || 0);
    updateEditorState();
    $('day-editor-modal').classList.remove('hidden');
  }

  function updateEditorState() {
    const enabled = $('editor-enabled').checked;
    $('editor-times-group').classList.toggle('disabled', !enabled);
    const startMin = Schedule.parseTimeToMinutes($('editor-start').value);
    const endMin = Schedule.parseTimeToMinutes($('editor-end').value);
    $('editor-midnight-hint').classList.toggle('hidden', !(enabled && endMin <= startMin));
  }

  function closeDayEditor() {
    $('day-editor-modal').classList.add('hidden');
    editingDayIndex = null;
  }

  // ========================================================================
  // REMINDERS VIEW (RAPPELS)
  // ========================================================================
  function populateSoundSelects() {
    const startSel = $('rem-start-sound');
    const endSel = $('rem-end-sound');
    [startSel, endSel].forEach((sel) => {
      sel.innerHTML = '';
      Reminders.SOUND_OPTIONS.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.id;
        option.textContent = opt.label;
        sel.appendChild(option);
      });
    });
  }

  function renderRemindersView() {
    const r = appData.reminders;
    $('rem-start-enabled').checked = r.startEnabled;
    $('rem-start-body').classList.toggle('disabled', !r.startEnabled);
    $('rem-start-30').checked = Boolean(r.startOffsets[30]);
    $('rem-start-15').checked = Boolean(r.startOffsets[15]);
    $('rem-start-5').checked = Boolean(r.startOffsets[5]);
    $('rem-start-0').checked = Boolean(r.startOffsets[0]);
    $('rem-start-sound').value = r.startSound;
    $('rem-start-repeat').checked = r.startRepeat;

    $('rem-end-enabled').checked = r.endEnabled;
    $('rem-end-body').classList.toggle('disabled', !r.endEnabled);
    $('rem-end-15').checked = Boolean(r.endOffsets[15]);
    $('rem-end-5').checked = Boolean(r.endOffsets[5]);
    $('rem-end-0').checked = Boolean(r.endOffsets[0]);
    $('rem-end-sound').value = r.endSound;
    $('rem-end-repeat').checked = r.endRepeat;

    const perm = Reminders.getPermissionStatus();
    const info = Settings.getPermissionBadgeInfo(perm);
    $('notif-status-text').textContent = `Statut : ${info.label}`;
    $('btn-request-notif').classList.toggle('hidden', !info.canRequest);
  }

  function showReminderAlertModal(alertObj) {
    activeAlert = alertObj;
    const isStart = alertObj.type === 'start';

    const iconWrap = $('alert-icon-wrap');
    iconWrap.className = `alert-hero-icon ${isStart ? 'alert-start' : 'alert-end'}`;

    $('alert-icon-svg').innerHTML = isStart
      ? '<path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/><path d="M4.2 8.2a9 9 0 0 0 0 7.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19.8 8.2a9 9 0 0 1 0 7.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M4 21L6.5 3.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6.4 4.2C8.5 3.4 10.5 5 12.6 4.4C14.7 3.8 16.5 4.8 18.5 4.1L17.4 12.6C15.4 13.3 13.6 12.3 11.5 12.9C9.4 13.5 7.4 11.9 5.3 12.7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.4 4.2L9.4 4.3L9 7.1L6 7Z M12.5 4.4L15.5 4.5L15.1 7.3L12.1 7.2Z M9 7.1L12.1 7.2L11.7 10L8.6 9.9Z M15.1 7.3L18.1 7.4L17.7 10.2L14.7 10.1Z M5.6 9.8L8.6 9.9L8.2 12.7L5.3 12.7Z M11.7 10L14.7 10.1L14.3 12.8L11.3 12.9Z" fill="currentColor"/>';

    $('alert-time-icon').innerHTML = isStart
      ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
      : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

    $('alert-title').textContent = alertObj.title;
    $('alert-scheduled-time').textContent = isStart
      ? alertObj.shift.startTime
      : alertObj.shift.endTime;
    $('alert-body').textContent = alertObj.body;

    const btnConfirm = $('btn-alert-confirm');
    btnConfirm.className = `btn btn-pill btn-block ${isStart ? 'btn-navy' : 'btn-danger'}`;
    $('btn-alert-confirm-text').textContent = isStart
      ? 'Confirmer le démarrage'
      : 'Terminer';
    $('btn-alert-snooze').textContent = isStart ? 'Plus tard' : 'Continuer mon shift';

    $('reminder-alert-modal').classList.remove('hidden');
  }

  function closeReminderAlertModal() {
    $('reminder-alert-modal').classList.add('hidden');
    activeAlert = null;
  }

  // ========================================================================
  // SETTINGS VIEW (PARAMÈTRES)
  // ========================================================================
  function renderSettingsView() {
    const name = (appData.employeeName || '').trim();
    $('settings-display-name').textContent = name || 'Employé Hudson';
    $('settings-name').value = name;

    const hasPhoto = Boolean(appData.profilePhoto);
    const avatarImg = $('profile-avatar-img');
    const avatarPlaceholder = $('profile-avatar-placeholder');
    if (hasPhoto) {
      avatarImg.src = appData.profilePhoto;
      avatarImg.classList.remove('hidden');
      avatarPlaceholder.classList.add('hidden');
    } else {
      avatarImg.classList.add('hidden');
      avatarPlaceholder.classList.remove('hidden');
    }
    $('btn-remove-photo').classList.toggle('hidden', !hasPhoto);

    $('settings-theme-select').value = appData.theme === 'dark' ? 'dark' : 'light';
    $('settings-monday-first').checked = Boolean(appData.weekStartsOnMonday);
    $('settings-volume').value = Math.round((appData.reminders.soundVolume ?? 0.8) * 100);

    const perm = Reminders.getPermissionStatus();
    const info = Settings.getPermissionBadgeInfo(perm);
    $('settings-notif-sub').textContent = info.label;
    $('settings-notif-toggle').checked = perm === 'granted';

    updatePWAInstallUI();
  }

  function updatePWAInstallUI() {
    const isStandalone = Settings.isStandaloneMode();
    const canInstall = Settings.canPromptInstall();
    $('pwa-installed-badge').classList.toggle('hidden', !isStandalone);
    $('btn-install-pwa').classList.toggle('hidden', isStandalone || !canInstall);
  }

  // ========================================================================
  // EVENT BINDINGS
  // ========================================================================
  function bindEvents() {
    // Onboarding
    $('btn-start-app').addEventListener('click', () => {
      appData.onboardingDone = true;
      Storage.save(appData);
      showAppShell();
      showToast('Bienvenue sur HUDSON SHIFT !', 'success');
    });

    $('btn-learn-more').addEventListener('click', () => {
      openConfirmDialog({
        title: 'À propos de HUDSON SHIFT',
        message:
          "HUDSON SHIFT est une application personnelle 100% gratuite. Vos horaires et confirmations restent stockés localement sur votre appareil. Elle ne se connecte jamais au système interne Hudson.",
        okLabel: 'Compris',
        okOnly: true,
        onConfirm: closeConfirmDialog
      });
    });

    // Navigation
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', () => switchView(el.dataset.nav));
    });
    $('btn-header-settings').addEventListener('click', () => switchView('parametres'));

    // Dashboard confirmations
    $('btn-confirm-start').addEventListener('click', () => confirmShiftAction('start'));
    $('btn-confirm-end').addEventListener('click', () => confirmShiftAction('end'));

    // Planning
    $('toggle-repeat-weekly').addEventListener('change', (e) => {
      appData.repeatWeekly = e.target.checked;
      Storage.save(appData);
      renderDashboard();
      showToast(
        appData.repeatWeekly ? 'Planning répété chaque semaine' : 'Répétition désactivée',
        'info'
      );
    });

    $('btn-reset-schedule').addEventListener('click', () => {
      openConfirmDialog({
        title: 'Réinitialiser le planning ?',
        message: 'Vos horaires seront remplacés par le planning par défaut.',
        okLabel: 'Réinitialiser',
        onConfirm: () => {
          appData = Storage.resetSchedule(appData);
          closeConfirmDialog();
          renderPlanning();
          renderDashboard();
          showToast('Planning réinitialisé', 'success');
        }
      });
    });

    // Day Editor Modal
    $('btn-close-editor').addEventListener('click', closeDayEditor);
    $('editor-enabled').addEventListener('change', updateEditorState);
    $('editor-start').addEventListener('change', updateEditorState);
    $('editor-end').addEventListener('change', updateEditorState);

    $('day-editor-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (editingDayIndex === null) return;
      appData.schedule[editingDayIndex] = {
        enabled: $('editor-enabled').checked,
        start: $('editor-start').value || '08:00',
        end: $('editor-end').value || '16:00',
        breakMinutes: Number($('editor-break').value) || 0
      };
      Storage.save(appData);
      closeDayEditor();
      renderPlanning();
      renderDashboard();
      showToast('Horaire enregistré', 'success');
    });

    $('btn-apply-all-workdays').addEventListener('click', () => {
      if (editingDayIndex === null) return;
      const startVal = $('editor-start').value || '08:00';
      const endVal = $('editor-end').value || '16:00';
      const breakVal = Number($('editor-break').value) || 0;
      for (let d = 0; d <= 6; d++) {
        if (d === editingDayIndex || appData.schedule[d].enabled) {
          appData.schedule[d] = {
            enabled: d === editingDayIndex ? $('editor-enabled').checked : true,
            start: startVal,
            end: endVal,
            breakMinutes: breakVal
          };
        }
      }
      Storage.save(appData);
      closeDayEditor();
      renderPlanning();
      renderDashboard();
      showToast('Horaire appliqué à tous les jours travaillés', 'success');
    });

    // Reminders View
    const saveReminders = () => {
      Storage.save(appData);
      renderRemindersView();
    };

    $('rem-start-enabled').addEventListener('change', (e) => {
      appData.reminders.startEnabled = e.target.checked;
      saveReminders();
    });
    [30, 15, 5, 0].forEach((offset) => {
      $(`rem-start-${offset}`).addEventListener('change', (e) => {
        appData.reminders.startOffsets[offset] = e.target.checked;
        saveReminders();
      });
    });
    $('rem-start-sound').addEventListener('change', (e) => {
      appData.reminders.startSound = e.target.value;
      saveReminders();
    });
    $('btn-test-start-sound').addEventListener('click', () => {
      Reminders.playSound(appData.reminders.startSound, appData.reminders.soundVolume);
    });
    $('rem-start-repeat').addEventListener('change', (e) => {
      appData.reminders.startRepeat = e.target.checked;
      saveReminders();
    });

    $('rem-end-enabled').addEventListener('change', (e) => {
      appData.reminders.endEnabled = e.target.checked;
      saveReminders();
    });
    [15, 5, 0].forEach((offset) => {
      $(`rem-end-${offset}`).addEventListener('change', (e) => {
        appData.reminders.endOffsets[offset] = e.target.checked;
        saveReminders();
      });
    });
    $('rem-end-sound').addEventListener('change', (e) => {
      appData.reminders.endSound = e.target.value;
      saveReminders();
    });
    $('btn-test-end-sound').addEventListener('click', () => {
      Reminders.playSound(appData.reminders.endSound, appData.reminders.soundVolume);
    });
    $('rem-end-repeat').addEventListener('change', (e) => {
      appData.reminders.endRepeat = e.target.checked;
      saveReminders();
    });

    const handleRequestNotif = async () => {
      const res = await Reminders.requestPermission();
      renderRemindersView();
      renderSettingsView();
      if (res === 'granted') {
        showToast('Notifications activées !', 'success');
      } else if (res === 'denied') {
        showToast('Notifications refusées dans le navigateur.', 'error');
      }
    };
    $('btn-request-notif').addEventListener('click', handleRequestNotif);
    $('settings-notif-toggle').addEventListener('change', async (e) => {
      if (e.target.checked) {
        await handleRequestNotif();
      } else {
        showToast('Désactivez les notifications dans les réglages du navigateur.', 'info');
        renderSettingsView();
      }
    });

    $('btn-test-notif').addEventListener('click', async () => {
      Reminders.playSound(appData.reminders.startSound, appData.reminders.soundVolume);
      const sent = await Reminders.sendSystemNotification(
        'Test HUDSON SHIFT',
        Reminders.START_MESSAGE,
        { tag: 'hudson-test' }
      );
      if (sent) {
        showToast('Notification de test envoyée !', 'success');
      } else {
        showToast('Activez les notifications pour recevoir des alertes système.', 'info');
      }
    });

    // Alert Modal Actions
    $('btn-alert-confirm').addEventListener('click', () => {
      if (activeAlert) {
        confirmShiftAction(activeAlert.type, activeAlert.shift);
      }
      closeReminderAlertModal();
    });

    $('btn-alert-snooze').addEventListener('click', () => {
      if (activeAlert) {
        const snoozeMins = activeAlert.type === 'end' ? 15 : 5;
        Reminders.snoozeReminder(appData, activeAlert.shift.shiftId, activeAlert.type, snoozeMins);
        showToast(
          activeAlert.type === 'end'
            ? 'Shift maintenu actif — nouveau rappel dans 15 min'
            : 'Rappel reporté de 5 minutes',
          'info'
        );
      }
      closeReminderAlertModal();
    });

    // Settings View
    function compressProfileImage(file, size = 256) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Lecture de l\'image impossible.'));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('Format d\'image non supporté.'));
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          };
          img.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });
    }

    $('btn-profile-photo').addEventListener('click', () => {
      $('input-profile-photo').click();
    });

    $('input-profile-photo').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        appData.profilePhoto = await compressProfileImage(file, 256);
        Storage.save(appData);
        renderSettingsView();
        renderDashboard();
        showToast('Photo de profil mise à jour', 'success');
      } catch (err) {
        showToast(err.message || 'Impossible d\'ajouter la photo.', 'error');
      }
      e.target.value = '';
    });

    $('btn-remove-photo').addEventListener('click', () => {
      appData.profilePhoto = '';
      Storage.save(appData);
      renderSettingsView();
      renderDashboard();
      showToast('Photo de profil supprimée', 'info');
    });

    $('btn-edit-name-toggle').addEventListener('click', () => {
      $('settings-name-editor').classList.toggle('hidden');
      $('settings-name').focus();
    });

    $('btn-save-name').addEventListener('click', () => {
      appData.employeeName = $('settings-name').value.trim();
      Storage.save(appData);
      $('settings-name-editor').classList.add('hidden');
      renderSettingsView();
      renderDashboard();
      showToast('Nom enregistré', 'success');
    });

    $('settings-theme-select').addEventListener('change', (e) => {
      appData.theme = e.target.value === 'dark' ? 'dark' : 'light';
      Settings.applyTheme(appData.theme);
      Storage.save(appData);
      renderSettingsView();
    });

    $('btn-toggle-data-panel').addEventListener('click', () => {
      $('settings-data-drawer').classList.toggle('hidden');
    });

    $('btn-about-modal').addEventListener('click', () => {
      openConfirmDialog({
        title: 'À propos — HUDSON Shift v1.0',
        message:
          "Application personnelle 100% gratuite conçue pour les employés Hudson Outlet. Elle ne se connecte à aucun système interne Hudson et conserve vos données localement sur votre appareil.",
        okLabel: 'Fermer',
        okOnly: true,
        onConfirm: closeConfirmDialog
      });
    });

    $('settings-monday-first').addEventListener('change', (e) => {
      appData.weekStartsOnMonday = e.target.checked;
      Storage.save(appData);
      renderPlanning();
      showToast('Ordre des jours mis à jour', 'success');
    });

    $('settings-volume').addEventListener('input', (e) => {
      appData.reminders.soundVolume = Number(e.target.value) / 100;
      Storage.save(appData);
    });

    $('btn-install-pwa').addEventListener('click', async () => {
      const res = await Settings.triggerPWAInstall();
      if (res && res.outcome === 'accepted') {
        showToast('Installation lancée !', 'success');
      }
      updatePWAInstallUI();
    });

    $('btn-export-json').addEventListener('click', () => {
      Settings.downloadJSONExport(appData);
      showToast('Planning exporté en JSON', 'success');
    });

    $('btn-import-json').addEventListener('click', () => {
      $('input-import-file').click();
    });

    $('input-import-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          appData = Storage.importJSON(String(reader.result || ''), appData);
          Settings.applyTheme(appData.theme);
          renderDashboard();
          renderPlanning();
          renderRemindersView();
          renderSettingsView();
          showToast('Planning importé avec succès !', 'success');
        } catch (err) {
          showToast(err.message || 'Fichier JSON invalide.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('btn-clear-data').addEventListener('click', () => {
      openConfirmDialog({
        title: 'Effacer toutes vos données ?',
        message:
          'Votre prénom, votre planning, vos préférences et vos confirmations seront définitivement supprimés de cet appareil.',
        okLabel: 'Tout effacer',
        onConfirm: () => {
          appData = Storage.clearAll();
          Settings.applyTheme(appData.theme);
          closeConfirmDialog();
          showOnboarding();
          showToast('Données locales effacées', 'info');
        }
      });
    });

    // Confirm Dialog
    $('btn-confirm-cancel').addEventListener('click', closeConfirmDialog);
    $('btn-confirm-ok').addEventListener('click', () => {
      if (typeof confirmCallback === 'function') confirmCallback();
    });

    // Online / Offline indicator
    const updateOnlineStatus = () => {
      $('offline-pill').classList.toggle('hidden', navigator.onLine);
      if ($('offline-pill-dash')) {
        $('offline-pill-dash').classList.toggle('hidden', navigator.onLine);
      }
    };
    global.addEventListener('online', updateOnlineStatus);
    global.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();
  }

  // ========================================================================
  // SERVICE WORKER REGISTRATION & BOOTSTRAP
  // ========================================================================
  function handleNotificationAction(action, shiftId) {
    if (!action || action === 'open') {
      switchView('accueil');
      return;
    }
    const targetShift = shiftId ? { shiftId } : null;
    if (action === 'confirm_start') {
      appData.onboardingDone = true;
      showAppShell();
      confirmShiftAction('start', targetShift);
    } else if (action === 'confirm_end') {
      appData.onboardingDone = true;
      showAppShell();
      confirmShiftAction('end', targetShift);
    } else if (action === 'continue_shift' && shiftId) {
      appData.onboardingDone = true;
      showAppShell();
      Reminders.snoozeReminder(appData, shiftId, 'end', 15);
      showToast('Shift maintenu actif — nouveau rappel dans 15 min', 'info');
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('./service-worker.js')
      .then(() => {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
            handleNotificationAction(event.data.action, event.data.data && event.data.data.shiftId);
          }
        });
      })
      .catch((err) => {
        console.warn('Service Worker non enregistré:', err);
      });
  }

  function init() {
    Settings.applyTheme(appData.theme);
    populateSoundSelects();
    Settings.initPWAInstallListener(() => updatePWAInstallUI());
    bindEvents();
    registerServiceWorker();

    const params = new URLSearchParams(global.location.search);
    const notifAction = params.get('notif_action');
    const shiftId = params.get('shift_id');
    if (notifAction) {
      global.history.replaceState({}, '', global.location.pathname);
      handleNotificationAction(notifAction, shiftId);
      return;
    }

    if (appData.onboardingDone) {
      showAppShell();
    } else {
      showOnboarding();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
