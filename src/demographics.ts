/**
 * Demographics Analysis Module
 * Processes student data to generate enrollment demographics reports
 */

import {
  StudentRecord,
  EnrollmentDemographicsSummary,
  DiversityMetrics,
  YearOverYearComparison,
} from './types.js';

/**
 * Generate a comprehensive demographics summary for enrolled students
 */
export function generateDemographicsSummary(
  students: StudentRecord[],
  entryYear: number,
  entryTerm: string = 'Fall'
): EnrollmentDemographicsSummary {
  // Filter to only enrolled students for the specified year/term
  const enrolled = students.filter(
    s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited'
  );

  const totalEnrolled = enrolled.length;

  // Aggregate by various dimensions
  const byGender = aggregateBy(enrolled, s => s.demographics.gender || 'Not Reported');
  const byEthnicity = aggregateBy(enrolled, s => s.demographics.ethnicity || 'Not Reported');
  const byRace = aggregateByMultiple(enrolled, s => s.demographics.race || ['Not Reported']);
  const byState = aggregateBy(enrolled, s => s.geographicInfo.state || 'Not Reported');
  const byCountry = aggregateBy(enrolled, s => s.geographicInfo.country || 'Not Reported');
  const byAdmitType = aggregateBy(enrolled, s => s.admitType);
  const byIntendedMajor = aggregateBy(enrolled, s => s.academicInfo.intendedMajor || 'Undeclared');
  const byIntendedCollege = aggregateBy(enrolled, s => s.academicInfo.intendedCollege || 'Not Specified');

  // Calculate special population counts
  const firstGenCount = enrolled.filter(s => s.demographics.firstGeneration === true).length;
  const internationalCount = enrolled.filter(s => s.geographicInfo.isInternational).length;
  const legacyCount = enrolled.filter(s => s.demographics.legacyStatus === true).length;

  // Calculate average GPA
  const gpas = enrolled
    .map(s => s.academicInfo.highSchoolGPA || s.academicInfo.transferGPA)
    .filter((gpa): gpa is number => gpa !== undefined && gpa > 0);
  const averageGPA = gpas.length > 0 ? gpas.reduce((a, b) => a + b, 0) / gpas.length : undefined;

  // Calculate average test scores
  const satScores = enrolled
    .map(s => s.academicInfo.testScores?.satTotal)
    .filter((score): score is number => score !== undefined && score > 0);
  const actScores = enrolled
    .map(s => s.academicInfo.testScores?.actComposite)
    .filter((score): score is number => score !== undefined && score > 0);

  const averageTestScores = {
    satTotal: satScores.length > 0 ? Math.round(satScores.reduce((a, b) => a + b, 0) / satScores.length) : undefined,
    actComposite: actScores.length > 0 ? Math.round(actScores.reduce((a, b) => a + b, 0) / actScores.length * 10) / 10 : undefined,
  };

  return {
    entryYear,
    entryTerm,
    totalEnrolled,
    byGender,
    byEthnicity,
    byRace,
    byState,
    byCountry,
    byAdmitType,
    byIntendedMajor,
    byIntendedCollege,
    firstGeneration: {
      count: firstGenCount,
      percentage: totalEnrolled > 0 ? round((firstGenCount / totalEnrolled) * 100, 1) : 0,
    },
    international: {
      count: internationalCount,
      percentage: totalEnrolled > 0 ? round((internationalCount / totalEnrolled) * 100, 1) : 0,
    },
    legacy: {
      count: legacyCount,
      percentage: totalEnrolled > 0 ? round((legacyCount / totalEnrolled) * 100, 1) : 0,
    },
    averageGPA: averageGPA ? round(averageGPA, 2) : undefined,
    averageTestScores: (averageTestScores.satTotal || averageTestScores.actComposite) ? averageTestScores : undefined,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate diversity metrics for a cohort
 */
export function generateDiversityMetrics(
  students: StudentRecord[],
  entryYear: number
): DiversityMetrics {
  const enrolled = students.filter(
    s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited'
  );

  const total = enrolled.length;

  // Calculate gender balance
  const genderCounts = aggregateBy(enrolled, s => s.demographics.gender || 'Not Reported');
  const genderPercentages: Record<string, number> = {};
  for (const [gender, count] of Object.entries(genderCounts)) {
    genderPercentages[gender] = total > 0 ? round((count / total) * 100, 1) : 0;
  }

  // Calculate URM percentage (commonly defined categories)
  const urmCategories = [
    'Black or African American',
    'Hispanic or Latino',
    'American Indian or Alaska Native',
    'Native Hawaiian or Other Pacific Islander',
    'Two or More Races',
  ];
  const urmCount = enrolled.filter(s => {
    const ethnicity = s.demographics.ethnicity?.toLowerCase() || '';
    const races = s.demographics.race || [];
    return urmCategories.some(cat =>
      ethnicity.includes(cat.toLowerCase()) ||
      races.some(r => r.toLowerCase().includes(cat.toLowerCase()))
    );
  }).length;

  // Geographic diversity
  const statesRepresented = new Set(
    enrolled
      .filter(s => s.geographicInfo.state && !s.geographicInfo.isInternational)
      .map(s => s.geographicInfo.state)
  ).size;

  const countriesRepresented = new Set(
    enrolled
      .filter(s => s.geographicInfo.country)
      .map(s => s.geographicInfo.country)
  ).size;

  const stateCounts = aggregateBy(
    enrolled.filter(s => !s.geographicInfo.isInternational),
    s => s.geographicInfo.state || 'Unknown'
  );
  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([state, count]) => ({ state, count }));

  const countryCounts = aggregateBy(enrolled, s => s.geographicInfo.country || 'Unknown');
  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, count]) => ({ country, count }));

  // Calculate diversity index (Simpson's Diversity Index)
  const ethnicityCounts = aggregateBy(enrolled, s => s.demographics.ethnicity || 'Not Reported');
  const diversityIndex = calculateSimpsonsDiversityIndex(Object.values(ethnicityCounts), total);

  // International and first-gen percentages
  const internationalCount = enrolled.filter(s => s.geographicInfo.isInternational).length;
  const firstGenCount = enrolled.filter(s => s.demographics.firstGeneration === true).length;

  return {
    entryYear,
    diversityIndex: round(diversityIndex, 3),
    underrepresentedMinorityPercentage: total > 0 ? round((urmCount / total) * 100, 1) : 0,
    internationalPercentage: total > 0 ? round((internationalCount / total) * 100, 1) : 0,
    firstGenerationPercentage: total > 0 ? round((firstGenCount / total) * 100, 1) : 0,
    genderBalance: {
      ratio: formatGenderRatio(genderCounts),
      percentages: genderPercentages,
    },
    geographicDiversity: {
      statesRepresented,
      countriesRepresented,
      topStates,
      topCountries,
    },
  };
}

/**
 * Generate year-over-year comparison
 */
export function generateYearOverYearComparison(
  studentsByYear: Map<number, StudentRecord[]>
): YearOverYearComparison {
  const years = Array.from(studentsByYear.keys()).sort();

  const metrics: YearOverYearComparison['metrics'] = [];

  // Total enrollment
  const enrollmentValues: Record<number, number> = {};
  for (const year of years) {
    const students = studentsByYear.get(year) || [];
    enrollmentValues[year] = students.filter(
      s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited'
    ).length;
  }
  metrics.push({
    metric: 'Total Enrolled',
    values: enrollmentValues,
    percentChange: calculatePercentChanges(enrollmentValues, years),
  });

  // First generation percentage
  const firstGenValues: Record<number, number> = {};
  for (const year of years) {
    const students = studentsByYear.get(year) || [];
    const enrolled = students.filter(s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited');
    const firstGen = enrolled.filter(s => s.demographics.firstGeneration === true).length;
    firstGenValues[year] = enrolled.length > 0 ? round((firstGen / enrolled.length) * 100, 1) : 0;
  }
  metrics.push({
    metric: 'First Generation %',
    values: firstGenValues,
    percentChange: calculatePercentChanges(firstGenValues, years),
  });

  // International percentage
  const intlValues: Record<number, number> = {};
  for (const year of years) {
    const students = studentsByYear.get(year) || [];
    const enrolled = students.filter(s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited');
    const intl = enrolled.filter(s => s.geographicInfo.isInternational).length;
    intlValues[year] = enrolled.length > 0 ? round((intl / enrolled.length) * 100, 1) : 0;
  }
  metrics.push({
    metric: 'International %',
    values: intlValues,
    percentChange: calculatePercentChanges(intlValues, years),
  });

  // URM percentage
  const urmValues: Record<number, number> = {};
  const urmCategories = [
    'Black or African American',
    'Hispanic or Latino',
    'American Indian or Alaska Native',
    'Native Hawaiian or Other Pacific Islander',
  ];
  for (const year of years) {
    const students = studentsByYear.get(year) || [];
    const enrolled = students.filter(s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited');
    const urm = enrolled.filter(s => {
      const ethnicity = s.demographics.ethnicity?.toLowerCase() || '';
      return urmCategories.some(cat => ethnicity.includes(cat.toLowerCase()));
    }).length;
    urmValues[year] = enrolled.length > 0 ? round((urm / enrolled.length) * 100, 1) : 0;
  }
  metrics.push({
    metric: 'URM %',
    values: urmValues,
    percentChange: calculatePercentChanges(urmValues, years),
  });

  // Average GPA
  const gpaValues: Record<number, number> = {};
  for (const year of years) {
    const students = studentsByYear.get(year) || [];
    const enrolled = students.filter(s => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited');
    const gpas = enrolled
      .map(s => s.academicInfo.highSchoolGPA)
      .filter((gpa): gpa is number => gpa !== undefined && gpa > 0);
    gpaValues[year] = gpas.length > 0 ? round(gpas.reduce((a, b) => a + b, 0) / gpas.length, 2) : 0;
  }
  metrics.push({
    metric: 'Average GPA',
    values: gpaValues,
    percentChange: calculatePercentChanges(gpaValues, years),
  });

  return { years, metrics };
}

/**
 * Format demographics summary as a readable report
 */
export function formatDemographicsReport(summary: EnrollmentDemographicsSummary): string {
  const lines: string[] = [
    `# Enrollment Demographics Report`,
    `## ${summary.entryTerm} ${summary.entryYear}`,
    ``,
    `**Total Enrolled:** ${summary.totalEnrolled}`,
    `**Report Generated:** ${new Date(summary.generatedAt).toLocaleDateString()}`,
    ``,
    `### Key Metrics`,
    `- First Generation: ${summary.firstGeneration.count} (${summary.firstGeneration.percentage}%)`,
    `- International: ${summary.international.count} (${summary.international.percentage}%)`,
    `- Legacy: ${summary.legacy.count} (${summary.legacy.percentage}%)`,
  ];

  if (summary.averageGPA) {
    lines.push(`- Average GPA: ${summary.averageGPA}`);
  }
  if (summary.averageTestScores?.satTotal) {
    lines.push(`- Average SAT: ${summary.averageTestScores.satTotal}`);
  }
  if (summary.averageTestScores?.actComposite) {
    lines.push(`- Average ACT: ${summary.averageTestScores.actComposite}`);
  }

  lines.push('', '### Gender Distribution');
  for (const [gender, count] of Object.entries(summary.byGender).sort((a, b) => b[1] - a[1])) {
    const pct = summary.totalEnrolled > 0 ? round((count / summary.totalEnrolled) * 100, 1) : 0;
    lines.push(`- ${gender}: ${count} (${pct}%)`);
  }

  lines.push('', '### Ethnicity Distribution');
  for (const [ethnicity, count] of Object.entries(summary.byEthnicity).sort((a, b) => b[1] - a[1])) {
    const pct = summary.totalEnrolled > 0 ? round((count / summary.totalEnrolled) * 100, 1) : 0;
    lines.push(`- ${ethnicity}: ${count} (${pct}%)`);
  }

  lines.push('', '### Geographic Distribution (Top 10 States)');
  const topStates = Object.entries(summary.byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [state, count] of topStates) {
    const pct = summary.totalEnrolled > 0 ? round((count / summary.totalEnrolled) * 100, 1) : 0;
    lines.push(`- ${state}: ${count} (${pct}%)`);
  }

  lines.push('', '### Admit Type Distribution');
  for (const [type, count] of Object.entries(summary.byAdmitType).sort((a, b) => b[1] - a[1])) {
    const pct = summary.totalEnrolled > 0 ? round((count / summary.totalEnrolled) * 100, 1) : 0;
    lines.push(`- ${type}: ${count} (${pct}%)`);
  }

  lines.push('', '### Top 10 Intended Majors');
  const topMajors = Object.entries(summary.byIntendedMajor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [major, count] of topMajors) {
    const pct = summary.totalEnrolled > 0 ? round((count / summary.totalEnrolled) * 100, 1) : 0;
    lines.push(`- ${major}: ${count} (${pct}%)`);
  }

  return lines.join('\n');
}

// Helper functions

function aggregateBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function aggregateByMultiple<T>(items: T[], keyFn: (item: T) => string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const keys = keyFn(item);
    for (const key of keys) {
      result[key] = (result[key] || 0) + 1;
    }
  }
  return result;
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function calculateSimpsonsDiversityIndex(counts: number[], total: number): number {
  if (total <= 1) return 0;
  let sum = 0;
  for (const n of counts) {
    sum += (n * (n - 1)) / (total * (total - 1));
  }
  return 1 - sum; // Return complement (1 - D) where higher = more diverse
}

function formatGenderRatio(genderCounts: Record<string, number>): string {
  const female = genderCounts['Female'] || genderCounts['F'] || genderCounts['Woman'] || 0;
  const male = genderCounts['Male'] || genderCounts['M'] || genderCounts['Man'] || 0;
  if (female === 0 && male === 0) return 'N/A';
  if (male === 0) return `${female}:0`;
  const ratio = round(female / male, 2);
  return `${ratio}:1 (F:M)`;
}

function calculatePercentChanges(
  values: Record<number, number>,
  years: number[]
): Record<string, number> {
  const changes: Record<string, number> = {};
  for (let i = 1; i < years.length; i++) {
    const prevYear = years[i - 1];
    const currYear = years[i];
    const prevValue = values[prevYear];
    const currValue = values[currYear];
    if (prevValue > 0) {
      changes[`${prevYear}-${currYear}`] = round(((currValue - prevValue) / prevValue) * 100, 1);
    }
  }
  return changes;
}
