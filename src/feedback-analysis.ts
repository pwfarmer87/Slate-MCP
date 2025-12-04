/**
 * Feedback Analysis Module
 * Analyzes course feedback data to generate reports and insights
 */

import {
  Course,
  CourseFeedback,
  FeedbackRatings,
  CourseFeedbackSummary,
  InstructorFeedbackSummary,
  DepartmentFeedbackSummary,
  FeedbackTrends,
  SentimentSummary,
} from './feedback-types.js';
import { FeedbackStore } from './feedback-store.js';

/**
 * Generate a comprehensive summary for a course
 */
export function generateCourseFeedbackSummary(
  store: FeedbackStore,
  courseId: string
): CourseFeedbackSummary | null {
  const course = store.getCourse(courseId);
  if (!course) return null;

  const feedback = store.getFeedbackByCourse(courseId);
  if (feedback.length === 0) {
    return {
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      instructorName: course.instructorName,
      term: course.term,
      year: course.year,
      totalResponses: 0,
      averageRatings: createEmptyRatings(),
      ratingDistributions: createEmptyDistributions(),
      recommendationRate: 0,
      sentimentAnalysis: createEmptySentiment(),
      generatedAt: new Date().toISOString(),
    };
  }

  const averageRatings = calculateAverageRatings(feedback);
  const ratingDistributions = calculateRatingDistributions(feedback);
  const recommendationRate = calculateRecommendationRate(feedback);
  const sentimentAnalysis = analyzeSentiment(feedback);

  return {
    courseId: course.id,
    courseCode: course.code,
    courseName: course.name,
    instructorName: course.instructorName,
    term: course.term,
    year: course.year,
    totalResponses: feedback.length,
    averageRatings,
    ratingDistributions,
    recommendationRate,
    sentimentAnalysis,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a summary for an instructor across all their courses
 */
export function generateInstructorFeedbackSummary(
  store: FeedbackStore,
  instructorId: string
): InstructorFeedbackSummary | null {
  const courses = store.getCoursesByInstructor(instructorId);
  if (courses.length === 0) return null;

  const instructorName = courses[0].instructorName;
  const feedback = store.getFeedbackByInstructor(instructorId);

  const courseBreakdown = courses.map(course => {
    const courseFeedback = store.getFeedbackByCourse(course.id);
    const avgRating =
      courseFeedback.length > 0
        ? round(
            courseFeedback.reduce((sum, fb) => sum + fb.ratings.overall, 0) /
              courseFeedback.length,
            2
          )
        : 0;

    return {
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      term: `${course.term} ${course.year}`,
      averageRating: avgRating,
      responseCount: courseFeedback.length,
    };
  });

  // Calculate trend over time
  const termGroups = new Map<string, CourseFeedback[]>();
  for (const fb of feedback) {
    const course = store.getCourse(fb.courseId);
    if (course) {
      const termKey = `${course.term} ${course.year}`;
      const existing = termGroups.get(termKey) || [];
      existing.push(fb);
      termGroups.set(termKey, existing);
    }
  }

  const trendOverTime = Array.from(termGroups.entries())
    .map(([term, fbs]) => ({
      term,
      averageRating: round(
        fbs.reduce((sum, fb) => sum + fb.ratings.overall, 0) / fbs.length,
        2
      ),
      responseCount: fbs.length,
    }))
    .sort((a, b) => a.term.localeCompare(b.term));

  const overallAverage =
    feedback.length > 0
      ? round(
          feedback.reduce((sum, fb) => sum + fb.ratings.overall, 0) /
            feedback.length,
          2
        )
      : 0;

  const avgEffectiveness =
    feedback.length > 0
      ? round(
          feedback.reduce((sum, fb) => sum + fb.ratings.instructorEffectiveness, 0) /
            feedback.length,
          2
        )
      : 0;

  return {
    instructorId,
    instructorName,
    totalCourses: courses.length,
    totalResponses: feedback.length,
    overallAverageRating: overallAverage,
    averageEffectiveness: avgEffectiveness,
    courseBreakdown,
    trendOverTime,
  };
}

/**
 * Generate a summary for a department
 */
export function generateDepartmentFeedbackSummary(
  store: FeedbackStore,
  department: string,
  term?: string,
  year?: number
): DepartmentFeedbackSummary | null {
  const courses = store.getCoursesByDepartment(department, term, year);
  if (courses.length === 0) return null;

  const feedback = store.getFeedbackByDepartment(department, term, year);

  // Calculate course ratings
  const courseRatings = courses.map(course => {
    const courseFeedback = store.getFeedbackByCourse(course.id);
    const avgRating =
      courseFeedback.length > 0
        ? round(
            courseFeedback.reduce((sum, fb) => sum + fb.ratings.overall, 0) /
              courseFeedback.length,
            2
          )
        : 0;
    return {
      courseCode: course.code,
      courseName: course.name,
      averageRating: avgRating,
      responseCount: courseFeedback.length,
    };
  }).filter(c => c.responseCount > 0);

  courseRatings.sort((a, b) => b.averageRating - a.averageRating);

  const topRatedCourses = courseRatings.slice(0, 5).map(c => ({
    courseCode: c.courseCode,
    courseName: c.courseName,
    averageRating: c.averageRating,
  }));

  const lowestRatedCourses = courseRatings
    .slice()
    .sort((a, b) => a.averageRating - b.averageRating)
    .slice(0, 5)
    .map(c => ({
      courseCode: c.courseCode,
      courseName: c.courseName,
      averageRating: c.averageRating,
    }));

  // Rating distribution
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const fb of feedback) {
    const rating = Math.round(fb.ratings.overall);
    ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
  }

  const avgOverall =
    feedback.length > 0
      ? round(
          feedback.reduce((sum, fb) => sum + fb.ratings.overall, 0) /
            feedback.length,
          2
        )
      : 0;

  return {
    department,
    term: term || 'All',
    year: year || new Date().getFullYear(),
    totalCourses: courses.length,
    totalResponses: feedback.length,
    averageOverallRating: avgOverall,
    topRatedCourses,
    lowestRatedCourses,
    ratingDistribution,
  };
}

/**
 * Generate feedback trends over time
 */
export function generateFeedbackTrends(
  store: FeedbackStore,
  options: {
    courseId?: string;
    instructorId?: string;
    department?: string;
  }
): FeedbackTrends | null {
  let feedback: CourseFeedback[] = [];

  if (options.courseId) {
    // For a specific course, get all instances of it (across terms)
    const allCourses = store.getAllCourses();
    const targetCourse = store.getCourse(options.courseId);
    if (!targetCourse) return null;

    const sameCodeCourses = allCourses.filter(c => c.code === targetCourse.code);
    for (const course of sameCodeCourses) {
      feedback.push(...store.getFeedbackByCourse(course.id));
    }
  } else if (options.instructorId) {
    feedback = store.getFeedbackByInstructor(options.instructorId);
  } else if (options.department) {
    feedback = store.getFeedbackByDepartment(options.department);
  } else {
    return null;
  }

  if (feedback.length === 0) return null;

  // Group by term/year
  const termGroups = new Map<string, { feedback: CourseFeedback[]; term: string; year: number }>();

  for (const fb of feedback) {
    const course = store.getCourse(fb.courseId);
    if (course) {
      const key = `${course.year}-${course.term}`;
      const existing = termGroups.get(key);
      if (existing) {
        existing.feedback.push(fb);
      } else {
        termGroups.set(key, { feedback: [fb], term: course.term, year: course.year });
      }
    }
  }

  const sortedTerms = Array.from(termGroups.entries())
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

  if (sortedTerms.length === 0) return null;

  const dataPoints = sortedTerms.map(([_, data]) => {
    const avgRating = round(
      data.feedback.reduce((sum, fb) => sum + fb.ratings.overall, 0) /
        data.feedback.length,
      2
    );
    const recommends = data.feedback.filter(fb => fb.wouldRecommend).length;
    const recommendationRate = round((recommends / data.feedback.length) * 100, 1);

    return {
      term: data.term,
      year: data.year,
      averageRating: avgRating,
      responseCount: data.feedback.length,
      recommendationRate,
    };
  });

  // Calculate overall trend
  const firstRating = dataPoints[0].averageRating;
  const lastRating = dataPoints[dataPoints.length - 1].averageRating;
  const percentageChange = firstRating > 0 ? round(((lastRating - firstRating) / firstRating) * 100, 1) : 0;

  let overallTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (percentageChange > 5) overallTrend = 'improving';
  else if (percentageChange < -5) overallTrend = 'declining';

  const firstData = sortedTerms[0][1];
  const lastData = sortedTerms[sortedTerms.length - 1][1];

  return {
    courseId: options.courseId,
    instructorId: options.instructorId,
    department: options.department,
    timeRange: {
      startTerm: firstData.term,
      startYear: firstData.year,
      endTerm: lastData.term,
      endYear: lastData.year,
    },
    dataPoints,
    overallTrend,
    percentageChange,
  };
}

/**
 * Format course summary as a readable report
 */
export function formatCourseFeedbackReport(summary: CourseFeedbackSummary): string {
  const lines: string[] = [
    `# Course Feedback Report`,
    `## ${summary.courseCode}: ${summary.courseName}`,
    ``,
    `**Instructor:** ${summary.instructorName}`,
    `**Term:** ${summary.term} ${summary.year}`,
    `**Total Responses:** ${summary.totalResponses}`,
    `**Report Generated:** ${new Date(summary.generatedAt).toLocaleDateString()}`,
    ``,
  ];

  if (summary.totalResponses === 0) {
    lines.push('*No feedback has been submitted for this course yet.*');
    return lines.join('\n');
  }

  lines.push(
    `### Overall Metrics`,
    `- **Overall Rating:** ${summary.averageRatings.overall}/5`,
    `- **Recommendation Rate:** ${summary.recommendationRate}%`,
    `- **Sentiment:** ${summary.sentimentAnalysis.overallSentiment}`,
    ``
  );

  lines.push(`### Detailed Ratings`);
  const ratingLabels: Record<keyof FeedbackRatings, string> = {
    overall: 'Overall Satisfaction',
    contentQuality: 'Content Quality',
    instructorEffectiveness: 'Instructor Effectiveness',
    courseDifficulty: 'Course Difficulty',
    workloadManageability: 'Workload',
    learningOutcomes: 'Learning Outcomes',
    materialsQuality: 'Materials Quality',
    engagementLevel: 'Engagement',
  };

  for (const [key, label] of Object.entries(ratingLabels)) {
    const rating = summary.averageRatings[key as keyof FeedbackRatings];
    const bar = createRatingBar(rating);
    lines.push(`- ${label}: ${bar} ${rating}/5`);
  }

  lines.push(``);

  if (summary.sentimentAnalysis.topStrengths.length > 0) {
    lines.push(`### Strengths`);
    for (const strength of summary.sentimentAnalysis.topStrengths) {
      lines.push(`- ${strength}`);
    }
    lines.push(``);
  }

  if (summary.sentimentAnalysis.topImprovements.length > 0) {
    lines.push(`### Areas for Improvement`);
    for (const improvement of summary.sentimentAnalysis.topImprovements) {
      lines.push(`- ${improvement}`);
    }
    lines.push(``);
  }

  lines.push(`### Rating Distribution`);
  for (let i = 5; i >= 1; i--) {
    const count = summary.ratingDistributions.overall[i] || 0;
    const pct = summary.totalResponses > 0 ? round((count / summary.totalResponses) * 100, 1) : 0;
    const bar = '█'.repeat(Math.round(pct / 5));
    lines.push(`${i}★: ${bar} ${count} (${pct}%)`);
  }

  return lines.join('\n');
}

/**
 * Format instructor summary as a readable report
 */
export function formatInstructorFeedbackReport(summary: InstructorFeedbackSummary): string {
  const lines: string[] = [
    `# Instructor Feedback Report`,
    `## ${summary.instructorName}`,
    ``,
    `**Total Courses:** ${summary.totalCourses}`,
    `**Total Responses:** ${summary.totalResponses}`,
    `**Overall Average Rating:** ${summary.overallAverageRating}/5`,
    `**Teaching Effectiveness:** ${summary.averageEffectiveness}/5`,
    ``,
  ];

  if (summary.courseBreakdown.length > 0) {
    lines.push(`### Course Performance`);
    for (const course of summary.courseBreakdown) {
      lines.push(
        `- **${course.courseCode}** (${course.term}): ${course.averageRating}/5 (${course.responseCount} responses)`
      );
    }
    lines.push(``);
  }

  if (summary.trendOverTime.length > 1) {
    lines.push(`### Performance Over Time`);
    for (const point of summary.trendOverTime) {
      lines.push(`- ${point.term}: ${point.averageRating}/5 (${point.responseCount} responses)`);
    }
  }

  return lines.join('\n');
}

/**
 * Format department summary as a readable report
 */
export function formatDepartmentFeedbackReport(summary: DepartmentFeedbackSummary): string {
  const lines: string[] = [
    `# Department Feedback Report`,
    `## ${summary.department}`,
    ``,
    `**Term:** ${summary.term} ${summary.year}`,
    `**Total Courses:** ${summary.totalCourses}`,
    `**Total Responses:** ${summary.totalResponses}`,
    `**Average Rating:** ${summary.averageOverallRating}/5`,
    ``,
  ];

  if (summary.topRatedCourses.length > 0) {
    lines.push(`### Top Rated Courses`);
    for (const course of summary.topRatedCourses) {
      lines.push(`- **${course.courseCode}** - ${course.courseName}: ${course.averageRating}/5`);
    }
    lines.push(``);
  }

  if (summary.lowestRatedCourses.length > 0) {
    lines.push(`### Courses Needing Attention`);
    for (const course of summary.lowestRatedCourses) {
      lines.push(`- **${course.courseCode}** - ${course.courseName}: ${course.averageRating}/5`);
    }
    lines.push(``);
  }

  lines.push(`### Rating Distribution`);
  const total = Object.values(summary.ratingDistribution).reduce((a, b) => a + b, 0);
  for (let i = 5; i >= 1; i--) {
    const count = summary.ratingDistribution[i] || 0;
    const pct = total > 0 ? round((count / total) * 100, 1) : 0;
    const bar = '█'.repeat(Math.round(pct / 5));
    lines.push(`${i}★: ${bar} ${count} (${pct}%)`);
  }

  return lines.join('\n');
}

// Helper functions

function calculateAverageRatings(feedback: CourseFeedback[]): FeedbackRatings {
  if (feedback.length === 0) return createEmptyRatings();

  const sums: FeedbackRatings = createEmptyRatings();
  const keys: (keyof FeedbackRatings)[] = [
    'overall',
    'contentQuality',
    'instructorEffectiveness',
    'courseDifficulty',
    'workloadManageability',
    'learningOutcomes',
    'materialsQuality',
    'engagementLevel',
  ];

  for (const fb of feedback) {
    for (const key of keys) {
      sums[key] += fb.ratings[key];
    }
  }

  const averages: FeedbackRatings = createEmptyRatings();
  for (const key of keys) {
    averages[key] = round(sums[key] / feedback.length, 2);
  }

  return averages;
}

function calculateRatingDistributions(
  feedback: CourseFeedback[]
): { [K in keyof FeedbackRatings]: Record<number, number> } {
  const distributions = createEmptyDistributions();
  const keys: (keyof FeedbackRatings)[] = [
    'overall',
    'contentQuality',
    'instructorEffectiveness',
    'courseDifficulty',
    'workloadManageability',
    'learningOutcomes',
    'materialsQuality',
    'engagementLevel',
  ];

  for (const fb of feedback) {
    for (const key of keys) {
      const rating = fb.ratings[key];
      distributions[key][rating] = (distributions[key][rating] || 0) + 1;
    }
  }

  return distributions;
}

function calculateRecommendationRate(feedback: CourseFeedback[]): number {
  if (feedback.length === 0) return 0;
  const recommends = feedback.filter(fb => fb.wouldRecommend).length;
  return round((recommends / feedback.length) * 100, 1);
}

function analyzeSentiment(feedback: CourseFeedback[]): SentimentSummary {
  const allStrengths: string[] = [];
  const allImprovements: string[] = [];
  const wordCounts = new Map<string, number>();

  // Common positive and negative words
  const positiveWords = new Set([
    'great', 'excellent', 'good', 'helpful', 'clear', 'engaging', 'interesting',
    'effective', 'organized', 'knowledgeable', 'supportive', 'amazing', 'fantastic',
    'thorough', 'enjoyable', 'valuable', 'insightful', 'passionate',
  ]);

  const negativeWords = new Set([
    'confusing', 'boring', 'difficult', 'unclear', 'disorganized', 'unhelpful',
    'frustrating', 'overwhelming', 'poor', 'bad', 'slow', 'rushed', 'unfair',
    'inconsistent', 'unprepared', 'tedious',
  ]);

  let positiveCount = 0;
  let negativeCount = 0;
  let totalWords = 0;

  for (const fb of feedback) {
    if (fb.comments.strengths) {
      allStrengths.push(fb.comments.strengths);
      countWords(fb.comments.strengths, wordCounts, positiveWords, negativeWords, (p, n) => {
        positiveCount += p;
        negativeCount += n;
      });
      totalWords += fb.comments.strengths.split(/\s+/).length;
    }

    if (fb.comments.improvements) {
      allImprovements.push(fb.comments.improvements);
      countWords(fb.comments.improvements, wordCounts, positiveWords, negativeWords, (p, n) => {
        positiveCount += p;
        negativeCount += n;
      });
      totalWords += fb.comments.improvements.split(/\s+/).length;
    }

    if (fb.comments.instructorFeedback) {
      countWords(fb.comments.instructorFeedback, wordCounts, positiveWords, negativeWords, (p, n) => {
        positiveCount += p;
        negativeCount += n;
      });
      totalWords += fb.comments.instructorFeedback.split(/\s+/).length;
    }

    if (fb.comments.additionalComments) {
      countWords(fb.comments.additionalComments, wordCounts, positiveWords, negativeWords, (p, n) => {
        positiveCount += p;
        negativeCount += n;
      });
      totalWords += fb.comments.additionalComments.split(/\s+/).length;
    }
  }

  // Calculate sentiment score (-1 to 1)
  const sentimentSum = positiveCount - negativeCount;
  const sentimentMax = positiveCount + negativeCount || 1;
  const sentimentScore = round(sentimentSum / sentimentMax, 2);

  // Determine overall sentiment
  let overallSentiment: 'positive' | 'neutral' | 'negative' | 'mixed' = 'neutral';
  if (sentimentScore > 0.3) overallSentiment = 'positive';
  else if (sentimentScore < -0.3) overallSentiment = 'negative';
  else if (positiveCount > 2 && negativeCount > 2) overallSentiment = 'mixed';

  // Extract top themes from strengths and improvements
  const topStrengths = extractTopThemes(allStrengths, 5);
  const topImprovements = extractTopThemes(allImprovements, 5);

  // Create word cloud from most common words
  const wordCloud = Array.from(wordCounts.entries())
    .filter(([word]) => word.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  return {
    overallSentiment,
    sentimentScore,
    topStrengths,
    topImprovements,
    wordCloud,
  };
}

function countWords(
  text: string,
  wordCounts: Map<string, number>,
  positiveWords: Set<string>,
  negativeWords: Set<string>,
  callback: (positive: number, negative: number) => void
): void {
  const words = text.toLowerCase().split(/\W+/);
  let positive = 0;
  let negative = 0;

  for (const word of words) {
    if (word.length < 2) continue;
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);

    if (positiveWords.has(word)) positive++;
    if (negativeWords.has(word)) negative++;
  }

  callback(positive, negative);
}

function extractTopThemes(comments: string[], limit: number): string[] {
  if (comments.length === 0) return [];

  // Simple extraction: return first sentence of most detailed comments
  const themes: string[] = [];
  const seen = new Set<string>();

  // Sort by length (more detailed comments first)
  const sorted = comments.slice().sort((a, b) => b.length - a.length);

  for (const comment of sorted) {
    if (themes.length >= limit) break;

    // Extract first sentence or whole comment if short
    const firstSentence = comment.split(/[.!?]/)[0].trim();
    if (firstSentence.length < 10) continue;

    // Check for similarity to existing themes
    const normalized = firstSentence.toLowerCase();
    if (seen.has(normalized)) continue;

    themes.push(firstSentence);
    seen.add(normalized);
  }

  return themes;
}

function createEmptyRatings(): FeedbackRatings {
  return {
    overall: 0,
    contentQuality: 0,
    instructorEffectiveness: 0,
    courseDifficulty: 0,
    workloadManageability: 0,
    learningOutcomes: 0,
    materialsQuality: 0,
    engagementLevel: 0,
  };
}

function createEmptyDistributions(): { [K in keyof FeedbackRatings]: Record<number, number> } {
  const empty = () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  return {
    overall: empty(),
    contentQuality: empty(),
    instructorEffectiveness: empty(),
    courseDifficulty: empty(),
    workloadManageability: empty(),
    learningOutcomes: empty(),
    materialsQuality: empty(),
    engagementLevel: empty(),
  };
}

function createEmptySentiment(): SentimentSummary {
  return {
    overallSentiment: 'neutral',
    sentimentScore: 0,
    topStrengths: [],
    topImprovements: [],
    wordCloud: [],
  };
}

function createRatingBar(rating: number): string {
  const filled = Math.round(rating);
  const empty = 5 - filled;
  return '★'.repeat(filled) + '☆'.repeat(empty);
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
