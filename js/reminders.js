/* ==========================================================================
   HUDSON SHIFT REMINDER — Smart Reminder Engine & Web Audio Synthesizer
   Uses Web Notifications API + Service Worker + Web Audio API + In-App Alerts.
   ========================================================================== */

(function (global) {
  'use strict';

  const START_SOON_MESSAGE =
    'Votre shift est bientôt prévu. Êtes-vous prêt à démarrer ?';
  const START_MESSAGE =
    "Il est temps de commencer votre shift ! N'oubliez pas de démarrer votre shift dans le système Hudson.";
  const END_SOON_MESSAGE =
    'Votre shift approche de sa fin. Souhaitez-vous terminer votre shift ?';
  const END_MESSAGE =
    "Votre shift est terminé ! N'oubliez pas de terminer votre shift dans le système Hudson.";

  const SOUND_OPTIONS = [
    { id: 'bell', label: 'Cloche' },
    { id: 'chime', label: 'Carillon' },
    { id: 'soft', label: 'Doux' },
    { id: 'alarm', label: 'Alarme' },
    { id: 'silent', label: 'Silencieux' }
  ];

  let audioCtx = null;
  let intervalId = null;
  let onTriggerCallback = null;

  function getAudioContext() {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(ctx, freq, startOffset, duration, type, volume) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);

    const t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume * 0.35), t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function playSound(soundId, volume = 0.8) {
    if (!soundId || soundId === 'silent' || volume <= 0) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      switch (soundId) {
        case 'bell':
          playTone(ctx, 880, 0, 0.35, 'sine', volume);
          playTone(ctx, 1174.66, 0.18, 0.45, 'sine', volume);
          break;
        case 'chime':
          playTone(ctx, 523.25, 0, 0.25, 'triangle', volume);
          playTone(ctx, 659.25, 0.16, 0.25, 'triangle', volume);
          playTone(ctx, 783.99, 0.32, 0.45, 'triangle', volume);
          break;
        case 'soft':
          playTone(ctx, 440, 0, 0.5, 'sine', volume * 0.7);
          break;
        case 'alarm':
          playTone(ctx, 987.77, 0, 0.16, 'square', volume * 0.6);
          playTone(ctx, 987.77, 0.22, 0.16, 'square', volume * 0.6);
          playTone(ctx, 1318.51, 0.44, 0.3, 'square', volume * 0.65);
          break;
        default:
          playTone(ctx, 880, 0, 0.3, 'sine', volume);
      }
    } catch (err) {
      console.warn('Lecture audio impossible:', err);
    }
  }

  function getPermissionStatus() {
    if (!('Notification' in global)) return 'unsupported';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  }

  async function requestPermission() {
    if (!('Notification' in global)) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch (err) {
      console.error('Erreur permission notification:', err);
      return getPermissionStatus();
    }
  }

  async function sendSystemNotification(title, body, data = {}) {
    if (getPermissionStatus() !== 'granted') return false;

    const actions =
      data.type === 'start'
        ? [{ action: 'confirm_start', title: 'Confirmer le démarrage' }]
        : data.type === 'end'
          ? [
              { action: 'confirm_end', title: 'Terminer' },
              { action: 'continue_shift', title: 'Continuer mon shift' }
            ]
          : [];

    const options = {
      body,
      icon: './assets/icon-192.png',
      badge: './assets/icon-192.png',
      tag: data.tag || `hudson-shift-${Date.now()}`,
      renotify: true,
      requireInteraction: true,
      data
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          try {
            await reg.showNotification(title, actions.length ? { ...options, actions } : options);
          } catch {
            await reg.showNotification(title, options);
          }
          return true;
        }
      }
      // Fallback to standard Notification API
      new Notification(title, options);
      return true;
    } catch (err) {
      console.warn('Notification système non affichée:', err);
      return false;
    }
  }

  function checkReminders(data, now = new Date()) {
    if (!data || !data.reminders) return null;

    const Schedule = global.HudsonSchedule;
    const nowMs = now.getTime();
    const candidates = [];

    // Check yesterday (overnight), today, and tomorrow (for 30-min-before midnight shifts)
    for (let offsetDays = -1; offsetDays <= 1; offsetDays++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
      const inst = Schedule.buildShiftInstance(data.schedule, d);
      if (inst) candidates.push(inst);
    }

    let triggered = null;

    for (const shift of candidates) {
      const conf = (data.confirmations && data.confirmations[shift.shiftId]) || {};
      const startMs = shift.startDate.getTime();
      const endMs = shift.endDate.getTime();

      // --- START REMINDERS ---
      if (data.reminders.startEnabled && !conf.startedAt) {
        const snoozeKey = `${shift.shiftId}_start`;
        const snoozedUntil = (data.snoozedUntil && data.snoozedUntil[snoozeKey]) || 0;

        if (nowMs >= snoozedUntil) {
          const offsets = [30, 15, 5, 0];
          // Check from most recent (0) to earliest (30) so reopening triggers the most relevant one
          const sortedOffsets = [...offsets].sort((a, b) => a - b);

          for (const minBefore of sortedOffsets) {
            if (!data.reminders.startOffsets[minBefore]) continue;
            const triggerMs = startMs - minBefore * 60 * 1000;
            const windowEndMs = endMs + 2 * 60 * 60 * 1000;
            const fireKey = `${shift.shiftId}_start_${minBefore}`;

            if (nowMs >= triggerMs && nowMs <= windowEndMs && !data.firedReminders[fireKey]) {
              data.firedReminders[fireKey] = nowMs;
              // Mark older offsets as superseded so user doesn't get flooded on reopen
              for (const earlier of offsets) {
                if (earlier > minBefore) {
                  data.firedReminders[`${shift.shiftId}_start_${earlier}`] = nowMs;
                }
              }
              triggered = {
                type: 'start',
                shift,
                minBefore,
                title:
                  minBefore === 0
                    ? 'Il est temps de commencer votre shift !'
                    : `Votre shift commence dans ${minBefore} min`,
                body: minBefore > 0 ? START_SOON_MESSAGE : START_MESSAGE,
                sound: data.reminders.startSound
              };
              break;
            }
          }

          // Repeat reminder every 5 min after start time if enabled and not confirmed
          if (!triggered && data.reminders.startRepeat && nowMs >= startMs && nowMs <= endMs) {
            const repeatSlot = Math.floor((nowMs - startMs) / (5 * 60 * 1000));
            if (repeatSlot >= 1) {
              const repeatKey = `${shift.shiftId}_start_repeat_${repeatSlot}`;
              if (!data.firedReminders[repeatKey]) {
                data.firedReminders[repeatKey] = nowMs;
                triggered = {
                  type: 'start',
                  shift,
                  minBefore: 0,
                  title: 'Rappel : Démarrez votre shift !',
                  body: START_MESSAGE,
                  sound: data.reminders.startSound
                };
              }
            }
          }
        }
      }

      if (triggered) break;

      // --- END REMINDERS (only if shift was explicitly started and not yet finished) ---
      if (data.reminders.endEnabled && conf.startedAt && !conf.finishedAt) {
        const snoozeKey = `${shift.shiftId}_end`;
        const snoozedUntil = (data.snoozedUntil && data.snoozedUntil[snoozeKey]) || 0;

        if (nowMs >= snoozedUntil) {
          const offsets = [15, 5, 0];
          const sortedOffsets = [...offsets].sort((a, b) => a - b);

          for (const minBefore of sortedOffsets) {
            if (!data.reminders.endOffsets[minBefore]) continue;
            const triggerMs = endMs - minBefore * 60 * 1000;
            const windowEndMs = endMs + 4 * 60 * 60 * 1000;
            const fireKey = `${shift.shiftId}_end_${minBefore}`;

            if (nowMs >= triggerMs && nowMs <= windowEndMs && !data.firedReminders[fireKey]) {
              data.firedReminders[fireKey] = nowMs;
              for (const earlier of offsets) {
                if (earlier > minBefore) {
                  data.firedReminders[`${shift.shiftId}_end_${earlier}`] = nowMs;
                }
              }
              triggered = {
                type: 'end',
                shift,
                minBefore,
                title:
                  minBefore === 0
                    ? 'Votre shift est terminé !'
                    : `Votre shift se termine dans ${minBefore} min`,
                body: minBefore > 0 ? END_SOON_MESSAGE : END_MESSAGE,
                sound: data.reminders.endSound
              };
              break;
            }
          }

          // Repeat reminder every 5 min after end time if enabled and not confirmed
          if (
            !triggered &&
            data.reminders.endRepeat &&
            nowMs >= endMs &&
            nowMs <= endMs + 2 * 60 * 60 * 1000
          ) {
            const repeatSlot = Math.floor((nowMs - endMs) / (5 * 60 * 1000));
            if (repeatSlot >= 1) {
              const repeatKey = `${shift.shiftId}_end_repeat_${repeatSlot}`;
              if (!data.firedReminders[repeatKey]) {
                data.firedReminders[repeatKey] = nowMs;
                triggered = {
                  type: 'end',
                  shift,
                  minBefore: 0,
                  title: 'Rappel : Terminez votre shift !',
                  body: END_MESSAGE,
                  sound: data.reminders.endSound
                };
              }
            }
          }
        }
      }

      if (triggered) break;
    }

    if (triggered) {
      global.HudsonStorage.save(data);
      playSound(triggered.sound, data.reminders.soundVolume);
      sendSystemNotification(triggered.title, triggered.body, {
        type: triggered.type,
        shiftId: triggered.shift.shiftId,
        tag: `hudson-${triggered.shift.shiftId}-${triggered.type}`
      });
      if (typeof onTriggerCallback === 'function') {
        onTriggerCallback(triggered);
      }
    }

    return triggered;
  }

  function snoozeReminder(data, shiftId, type, minutes = 5) {
    if (!data.snoozedUntil) data.snoozedUntil = {};
    data.snoozedUntil[`${shiftId}_${type}`] = Date.now() + minutes * 60 * 1000;
    global.HudsonStorage.save(data);
  }

  function startEngine(getDataFn, onTrigger) {
    onTriggerCallback = onTrigger;
    if (intervalId) clearInterval(intervalId);

    // Immediate check on startup / reopen
    checkReminders(getDataFn(), new Date());

    intervalId = setInterval(() => {
      checkReminders(getDataFn(), new Date());
    }, 5000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkReminders(getDataFn(), new Date());
      }
    });
  }

  global.HudsonReminders = {
    START_SOON_MESSAGE,
    START_MESSAGE,
    END_SOON_MESSAGE,
    END_MESSAGE,
    SOUND_OPTIONS,
    playSound,
    getPermissionStatus,
    requestPermission,
    sendSystemNotification,
    checkReminders,
    snoozeReminder,
    startEngine
  };
})(window);
