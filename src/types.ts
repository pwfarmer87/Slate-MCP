/**
 * Type definitions for Slate MCP Server
 */

// Slate API Configuration
export interface SlateConfig {
  baseUrl: string;
  username: string;
  password: string;
  // Optional: some Slate instances use API keys instead
  apiKey?: string;
}

// Student demographic data from Slate
export interface StudentRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  applicationStatus: ApplicationStatus;
  admitType: AdmitType;
  enrollmentStatus: EnrollmentStatus;
  entryTerm: string;
  entryYear: number;
  demographics: Demographics;
  academicInfo: AcademicInfo;
  geographicInfo: GeographicInfo;
}

export interface Demographics {
  gender?: string;
  ethnicity?: string;
  race?: string[];
  citizenship?: string;
  firstGeneration?: boolean;
  legacyStatus?: boolean;
  veteranStatus?: boolean;
  dateOfBirth?: string;
}

export interface AcademicInfo {
  intendedMajor?: string;
  intendedCollege?: string;
  highSchoolGPA?: number;
  transferGPA?: number;
  testScores?: TestScores;
  highSchoolName?: string;
  highSchoolCity?: string;
  highSchoolState?: string;
}

export interface TestScores {
  satTotal?: number;
  satMath?: number;
  satVerbal?: number;
  actComposite?: number;
}

export interface GeographicInfo {
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  region?: string;
  isInternational: boolean;
}

export type ApplicationStatus =
  | 'prospect'
  | 'inquiry'
  | 'applicant'
  | 'admitted'
  | 'denied'
  | 'waitlisted'
  | 'withdrawn';

export type AdmitType =
  | 'freshman'
  | 'transfer'
  | 'graduate'
  | 'readmit'
  | 'non-degree';

export type EnrollmentStatus =
  | 'not_enrolled'
  | 'deposited'
  | 'enrolled'
  | 'deferred'
  | 'withdrawn';

// Enrollment Demographics Summary
export interface EnrollmentDemographicsSummary {
  entryYear: number;
  entryTerm: string;
  totalEnrolled: number;
  byGender: Record<string, number>;
  byEthnicity: Record<string, number>;
  byRace: Record<string, number>;
  byState: Record<string, number>;
  byCountry: Record<string, number>;
  byAdmitType: Record<string, number>;
  byIntendedMajor: Record<string, number>;
  byIntendedCollege: Record<string, number>;
  firstGeneration: {
    count: number;
    percentage: number;
  };
  international: {
    count: number;
    percentage: number;
  };
  legacy: {
    count: number;
    percentage: number;
  };
  averageGPA?: number;
  averageTestScores?: {
    satTotal?: number;
    actComposite?: number;
  };
  generatedAt: string;
}

// Slate Query response format
export interface SlateQueryResponse<T> {
  row: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

// Slate Query parameters
export interface SlateQueryParams {
  query: string;
  format?: 'json' | 'xml' | 'csv';
  page?: number;
  pageSize?: number;
  filters?: Record<string, string | number | boolean>;
}

// Year-over-year comparison
export interface YearOverYearComparison {
  years: number[];
  metrics: {
    metric: string;
    values: Record<number, number>;
    percentChange: Record<string, number>;
  }[];
}

// Diversity metrics
export interface DiversityMetrics {
  entryYear: number;
  diversityIndex: number;
  underrepresentedMinorityPercentage: number;
  internationalPercentage: number;
  firstGenerationPercentage: number;
  genderBalance: {
    ratio: string;
    percentages: Record<string, number>;
  };
  geographicDiversity: {
    statesRepresented: number;
    countriesRepresented: number;
    topStates: { state: string; count: number }[];
    topCountries: { country: string; count: number }[];
  };
}
