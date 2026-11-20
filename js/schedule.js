/* ==========================================================================
   HUDSON SHIFT REMINDER — Schedule & Shift Calculation Engine
   Handles weekly schedules, overnight shifts, countdowns, and shift statuses.
   ========================================================================== */

(function (global) {
  'use strict';

  const DAY_NAMES_FR = [
    'Dimanche',
    'Lundi',
    'Mardi',
    'Mercredi',
    'Jeudi',
    'Vendredi',
    'Samedi'
  ];

  const MONTH_NAMES_FR = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre'
  ];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function formatFrenchDate(date) {
    const dayName = DAY_NAMES_FR[date.getDay()];
    const dayNum = date.getDate();
    const monthName = MONTH_NAMES_FR[date.getMonth()];
    return `${dayName}, ${dayNum} ${monthName}`;
  }

  function formatTimeShort(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function parseTimeToMinutes(hhmm) {
    const [h, m] = (hhmm || '00:00').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  function getShiftDurationMinutes(dayConfig) {
    if (!dayConfig || !dayConfig.enabled) {
      return { grossMinutes: 0, netMinutes: 0, crossesMidnight: false };
    }
    const startMin = parseTimeToMinutes(dayConfig.start);
    const endMin = parseTimeToMinutes(dayConfig.end);
    const crossesMidnight = endMin <= startMin;
    const grossMinutes = crossesMidnight ? endMin + 1440 - startMin : endMin - startMin;
    const breakMin = Math.max(0, Number(dayConfig.breakMinutes) || 0);
    const netMinutes = Math.max(0, grossMinutes - breakMin);
    return { grossMinutes, netMinutes, crossesMidnight };
  }

  function formatDuration(minutes) {
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${pad2(m)}`;
  }

  function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (days > 0) {
      return `${days}j ${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`;
    }
    return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`;
  }

  function buildShiftInstance(schedule, baseDate) {
    const dayOfWeek = baseDate.getDay();
    const cfg = schedule[dayOfWeek];
    if (!cfg || !cfg.enabled) return null;

    const [sh, sm] = cfg.start.split(':').map(Number);
    const [eh, em] = cfg.end.split(':').map(Number);

    const startDate = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      sh,
      sm,
      0,
      0
    );

    const crossesMidnight = eh * 60 + em <= sh * 60 + sm;
    const endDate = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate() + (crossesMidnight ? 1 : 0),
      eh,
      em,
      0,
      0
    );

    const { grossMinutes, netMinutes } = getShiftDurationMinutes(cfg);
    const dateKey = formatDateKey(baseDate);

    return {
      shiftId: dateKey,
      dateKey,
      dayOfWeek,
      dayName: DAY_NAMES_FR[dayOfWeek],
      startTime: cfg.start,
      endTime: cfg.end,
      breakMinutes: Math.max(0, Number(cfg.breakMinutes) || 0),
      startDate,
      endDate,
      crossesMidnight,
      grossMinutes,
      netMinutes
    };
  }

  function getOrderedDays(weekStartsOnMonday) {
    return weekStartsOnMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  }

  function getWeeklySummary(schedule) {
    let workingDays = 0;
    let totalNetMinutes = 0;
    for (let d = 0; d <= 6; d++) {
      const cfg = schedule[d];
      if (cfg && cfg.enabled) {
        workingDays++;
        totalNetMinutes += getShiftDurationMinutes(cfg).netMinutes;
      }
    }
    return {
      workingDays,
      restDays: 7 - workingDays,
      totalNetMinutes,
      formattedHours: formatDuration(totalNetMinutes)
    };
  }

  /**
   * Computes the primary shift to display on the Dashboard, its status,
   * countdown target, and today's shift details.
   */
  function getDashboardState(data, now = new Date()) {
    const schedule = data.schedule;
    const confirmations = data.confirmations || {};

    const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    const yesterdayShift = buildShiftInstance(schedule, yesterdayBase);
    const todayShift = buildShiftInstance(schedule, todayBase);

    let activeShift = null;
    let isTodayRest = !todayShift;

    // 1. Check if yesterday's overnight shift is still ongoing or within 2h of ending (unconfirmed)
    if (yesterdayShift && yesterdayShift.crossesMidnight) {
      const yConf = confirmations[yesterdayShift.shiftId] || {};
      const graceEnd = yesterdayShift.endDate.getTime() + 2 * 60 * 60 * 1000;
      if (now.getTime() <= yesterdayShift.endDate.getTime() || (!yConf.finishedAt && now.getTime() <= graceEnd)) {
        activeShift = yesterdayShift;
      }
    }

    // 2. Otherwise check today's shift if it hasn't ended > 2h ago (or if it's confirmed finished, keep showing today's status until midnight or next shift)
    if (!activeShift && todayShift) {
      const tConf = confirmations[todayShift.shiftId] || {};
      const twoHoursAfterEnd = todayShift.endDate.getTime() + 2 * 60 * 60 * 1000;
      if (now.getTime() <= twoHoursAfterEnd || (tConf.startedAt && !tConf.finishedAt)) {
        activeShift = todayShift;
      }
    }

    // 3. If no active shift for today/yesterday, find the next upcoming shift in the next 7 days
    let nextUpcomingShift = null;
    if (!activeShift) {
      const startOffset = todayShift && now.getTime() > todayShift.endDate.getTime() ? 1 : 0;
      const maxDays = data.repeatWeekly ? 7 : 7;
      for (let i = startOffset; i <= maxDays; i++) {
        const candidateDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        const candidate = buildShiftInstance(schedule, candidateDate);
        if (candidate && candidate.startDate.getTime() > now.getTime()) {
          nextUpcomingShift = candidate;
          break;
        }
      }
    }

    const focusShift = activeShift || nextUpcomingShift;

    // Determine dynamic status
    let status = {
      code: 'no_shift',
      label: 'Aucun shift planifié',
      badgeClass: 'badge-muted',
      countdownLabel: '',
      countdownMs: 0
    };

    if (focusShift) {
      const conf = confirmations[focusShift.shiftId] || {};
      const nowMs = now.getTime();
      const startMs = focusShift.startDate.getTime();
      const endMs = focusShift.endDate.getTime();

      if (conf.finishedAt) {
        status = {
          code: 'finished',
          label: 'Shift terminé',
          badgeClass: 'badge-success',
          countdownLabel: 'Confirmé terminé',
          countdownMs: 0
        };
      } else if (conf.startedAt) {
        const msToEnd = endMs - nowMs;
        if (msToEnd <= 0) {
          status = {
            code: 'ending_soon',
            label: 'Heure de terminer',
            badgeClass: 'badge-danger',
            countdownLabel: 'Shift terminé — confirmez',
            countdownMs: 0
          };
        } else if (msToEnd <= 15 * 60 * 1000) {
          status = {
            code: 'ending_soon',
            label: 'Fin bientôt',
            badgeClass: 'badge-warning',
            countdownLabel: 'Avant la fin',
            countdownMs: msToEnd
          };
        } else {
          status = {
            code: 'started',
            label: 'Shift en cours',
            badgeClass: 'badge-active',
            countdownLabel: 'Avant la fin',
            countdownMs: msToEnd
          };
        }
      } else {
        // Not started yet (manual confirmation not clicked)
        const msToStart = startMs - nowMs;
        if (msToStart <= 0) {
          status = {
            code: 'time_to_start',
            label: 'Heure de commencer',
            badgeClass: 'badge-danger',
            countdownLabel: 'Démarrez votre shift',
            countdownMs: 0
          };
        } else if (msToStart <= 30 * 60 * 1000) {
          status = {
            code: 'starting_soon',
            label: 'Bientôt',
            badgeClass: 'badge-warning',
            countdownLabel: 'Avant le début',
            countdownMs: msToStart
          };
        } else {
          status = {
            code: 'upcoming',
            label: isTodayRest && focusShift.dateKey !== formatDateKey(now) ? 'Jour de repos • Prochain shift' : 'Prochain shift',
            badgeClass: 'badge-info',
            countdownLabel: 'Avant le début',
            countdownMs: msToStart
          };
        }
      }
    }

    return {
      now,
      todayShift,
      isTodayRest,
      focusShift,
      focusConfirmation: focusShift ? (confirmations[focusShift.shiftId] || {}) : {},
      status
    };
  }

  global.HudsonSchedule = {
    DAY_NAMES_FR,
    MONTH_NAMES_FR,
    formatDateKey,
    formatFrenchDate,
    formatTimeShort,
    parseTimeToMinutes,
    getShiftDurationMinutes,
    formatDuration,
    formatCountdown,
    buildShiftInstance,
    getOrderedDays,
    getWeeklySummary,
    getDashboardState
  };
})(window);
