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

const getCompetitionWindow = (year, month) => {
  const start = getFirstSaturday(year, month);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startTime: start, endTime: end };
};

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
  calculateCompetitionScore,
  rankParticipants,
};
