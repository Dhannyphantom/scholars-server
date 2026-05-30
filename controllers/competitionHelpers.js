/**
 * Helpers for monthly Online Quiz Competition scheduling.
 * Competition runs on the first Saturday of each month for 24 hours.
 */

const getFirstSaturday = (year, month) => {
  const firstDay = new Date(year, month - 1, 1);
  const dayOfWeek = firstDay.getDay();
  const dayOfMonth = dayOfWeek === 6 ? 1 : 1 + ((6 - dayOfWeek + 7) % 7);
  return new Date(year, month - 1, dayOfMonth);
};

/**
 * getCompetitionWindow
 *
 * Returns the competition window for a given month/year.
 * Default: first Saturday of the month, 00:00 → +24 h.
 *
 * If both startOverride and endOverride are supplied (ISO strings or Dates)
 * those values are used as-is — allowing managers to shift the window without
 * touching the default logic.
 *
 * @param {number}           year
 * @param {number}           month         1-based
 * @param {string|Date|null} startOverride optional manager-supplied start
 * @param {string|Date|null} endOverride   optional manager-supplied end
 */
const getCompetitionWindow = (
  year,
  month,
  startOverride = null,
  endOverride = null,
) => {
  if (startOverride && endOverride) {
    return {
      startTime: new Date(startOverride),
      endTime: new Date(endOverride),
    };
  }

  const start = getFirstSaturday(year, month);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startTime: start, endTime: end };
};

/**
 * computeCompetitionMeta — DB subjects only (legacy, kept for compatibility).
 */
const computeCompetitionMeta = (subjects = []) => {
  let totalQuestions = 0;
  let approxDuration = 0;

  subjects.forEach((s) => {
    const count = s.questionsCount || 0;
    const timePerQ = s.timePerQuestion || 40;
    totalQuestions += count;
    approxDuration += count * timePerQ;
  });

  return { totalQuestions, approxDuration };
};

/**
 * computeFullMeta — counts questions across both DB subjects AND custom subjects.
 * Use this everywhere a competition is created or updated.
 *
 * @param {Array} subjects       DB subject configs
 * @param {Array} customSubjects Custom subject configs
 */
const computeFullMeta = (subjects = [], customSubjects = []) => {
  const dbTotal = subjects.reduce((s, c) => s + (c.questionsCount || 0), 0);
  const dbDuration = subjects.reduce(
    (s, c) => s + (c.questionsCount || 0) * (c.timePerQuestion || 40),
    0,
  );
  const customTotal = customSubjects.reduce(
    (s, c) => s + (c.questionsCount || 0),
    0,
  );
  const customDuration = customSubjects.reduce(
    (s, c) => s + (c.questionsCount || 0) * (c.timePerQuestion || 40),
    0,
  );
  return {
    totalQuestions: dbTotal + customTotal,
    approxDuration: dbDuration + customDuration,
  };
};

const calculateCompetitionScore = (questions, qBankMap) => {
  const POINTS_NEW_WRONG = -2;
  const POINTS_RETRY_NOW_CORRECT = 1;
  const POINTS_RETRY_NOW_WRONG = -0.2;
  const POINTS_PREV_CORRECT_RETRY = 0;

  let totalPoints = 0;
  let correctAnswers = 0;
  let totalQuestions = 0;
  const qBankUpdates = {};

  questions.forEach((quest) => {
    quest.questions.forEach((question) => {
      totalQuestions++;
      const questionId = question._id.toString();
      const isCorrect = !!question.answered?.correct;
      const qBankEntry = qBankMap.get(questionId);
      const isNew = qBankEntry === undefined;
      const wasPrevCorrect = !isNew && qBankEntry.correct === true;

      if (isNew) {
        totalPoints += isCorrect ? question.point || 1 : POINTS_NEW_WRONG;
      } else if (wasPrevCorrect) {
        totalPoints += isCorrect
          ? POINTS_PREV_CORRECT_RETRY
          : POINTS_RETRY_NOW_WRONG;
      } else {
        totalPoints += isCorrect
          ? POINTS_RETRY_NOW_CORRECT
          : POINTS_RETRY_NOW_WRONG;
      }

      if (isCorrect) correctAnswers++;
      qBankUpdates[questionId] = isCorrect;
    });
  });

  const accuracy =
    totalQuestions > 0
      ? parseFloat(((correctAnswers / totalQuestions) * 100).toFixed(2))
      : 0;

  return {
    score: parseFloat(totalPoints.toFixed(2)),
    correctAnswers,
    totalQuestions,
    accuracy,
    qBankUpdates,
  };
};

const rankParticipants = (participants) => {
  const ranked = [...participants]
    .filter((p) => p.hasParticipated)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.duration && b.duration) return a.duration - b.duration;
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    });

  ranked.forEach((p, idx) => {
    p.rank = idx + 1;
  });

  return ranked;
};

module.exports = {
  getFirstSaturday,
  getCompetitionWindow,
  computeCompetitionMeta,
  computeFullMeta,
  calculateCompetitionScore,
  rankParticipants,
};
