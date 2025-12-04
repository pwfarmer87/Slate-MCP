/**
 * Slate API Client
 * Handles authentication and data retrieval from Technolutions Slate
 */

import {
  SlateConfig,
  StudentRecord,
  SlateQueryResponse,
  SlateQueryParams,
  Demographics,
  AcademicInfo,
  GeographicInfo,
  ApplicationStatus,
  AdmitType,
  EnrollmentStatus,
} from './types.js';

export class SlateClient {
  private config: SlateConfig;
  private authHeader: string;

  constructor(config: SlateConfig) {
    this.config = config;
    // Slate typically uses Basic Auth
    this.authHeader = 'Basic ' + Buffer.from(
      `${config.username}:${config.password}`
    ).toString('base64');
  }

  /**
   * Make an authenticated request to the Slate API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // If API key is provided, use it instead
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Slate API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Execute a Slate query to retrieve data
   * Slate queries are typically defined in the Slate admin panel and exposed via API
   */
  async executeQuery<T>(params: SlateQueryParams): Promise<SlateQueryResponse<T>> {
    const queryParams = new URLSearchParams({
      cmd: 'query',
      q: params.query,
      format: params.format || 'json',
    });

    if (params.page) {
      queryParams.append('page', params.page.toString());
    }
    if (params.pageSize) {
      queryParams.append('pageSize', params.pageSize.toString());
    }
    if (params.filters) {
      Object.entries(params.filters).forEach(([key, value]) => {
        queryParams.append(key, String(value));
      });
    }

    return this.request<SlateQueryResponse<T>>(
      `/manage/query/run?${queryParams.toString()}`
    );
  }

  /**
   * Get enrolled students for a specific entry year and term
   */
  async getEnrolledStudents(
    entryYear: number,
    entryTerm?: string
  ): Promise<StudentRecord[]> {
    // This query name should match what's configured in your Slate instance
    // Common query names: enrolled_students, enrollment_census, etc.
    const queryName = 'enrollment_demographics';

    const filters: Record<string, string | number> = {
      entry_year: entryYear,
    };

    if (entryTerm) {
      filters.entry_term = entryTerm;
    }

    const response = await this.executeQuery<RawSlateStudent>({
      query: queryName,
      filters,
    });

    return response.row.map(this.mapToStudentRecord);
  }

  /**
   * Get all students by application status
   */
  async getStudentsByStatus(
    status: ApplicationStatus,
    entryYear?: number
  ): Promise<StudentRecord[]> {
    const queryName = 'students_by_status';

    const filters: Record<string, string | number> = {
      application_status: status,
    };

    if (entryYear) {
      filters.entry_year = entryYear;
    }

    const response = await this.executeQuery<RawSlateStudent>({
      query: queryName,
      filters,
    });

    return response.row.map(this.mapToStudentRecord);
  }

  /**
   * Get funnel data (prospects -> applicants -> admitted -> enrolled)
   */
  async getFunnelData(entryYear: number, entryTerm?: string): Promise<FunnelData> {
    const queryName = 'enrollment_funnel';

    const filters: Record<string, string | number> = {
      entry_year: entryYear,
    };

    if (entryTerm) {
      filters.entry_term = entryTerm;
    }

    const response = await this.executeQuery<RawFunnelData>({
      query: queryName,
      filters,
    });

    // Aggregate funnel data
    const funnel: FunnelData = {
      entryYear,
      entryTerm: entryTerm || 'All',
      prospects: 0,
      inquiries: 0,
      applicants: 0,
      admitted: 0,
      deposited: 0,
      enrolled: 0,
    };

    for (const row of response.row) {
      funnel.prospects += row.prospects || 0;
      funnel.inquiries += row.inquiries || 0;
      funnel.applicants += row.applicants || 0;
      funnel.admitted += row.admitted || 0;
      funnel.deposited += row.deposited || 0;
      funnel.enrolled += row.enrolled || 0;
    }

    return funnel;
  }

  /**
   * Map raw Slate response to our StudentRecord type
   */
  private mapToStudentRecord(raw: RawSlateStudent): StudentRecord {
    const demographics: Demographics = {
      gender: raw.gender || raw.sex,
      ethnicity: raw.ethnicity || raw.ethnic_code,
      race: raw.race ? (Array.isArray(raw.race) ? raw.race : [raw.race]) : undefined,
      citizenship: raw.citizenship || raw.citizen,
      firstGeneration: parseBoolean(raw.first_gen || raw.first_generation),
      legacyStatus: parseBoolean(raw.legacy || raw.legacy_status),
      veteranStatus: parseBoolean(raw.veteran || raw.veteran_status),
      dateOfBirth: raw.birth_date || raw.dob,
    };

    const academicInfo: AcademicInfo = {
      intendedMajor: raw.major || raw.intended_major || raw.major_1,
      intendedCollege: raw.college || raw.intended_college,
      highSchoolGPA: parseFloat(raw.hs_gpa || raw.high_school_gpa || '') || undefined,
      transferGPA: parseFloat(raw.transfer_gpa || '') || undefined,
      testScores: {
        satTotal: parseInt(raw.sat_total || raw.sat_composite || '', 10) || undefined,
        satMath: parseInt(raw.sat_math || '', 10) || undefined,
        satVerbal: parseInt(raw.sat_verbal || raw.sat_ebrw || '', 10) || undefined,
        actComposite: parseInt(raw.act_composite || raw.act || '', 10) || undefined,
      },
      highSchoolName: raw.hs_name || raw.high_school_name,
      highSchoolCity: raw.hs_city || raw.high_school_city,
      highSchoolState: raw.hs_state || raw.high_school_state,
    };

    const geographicInfo: GeographicInfo = {
      city: raw.city || raw.home_city,
      state: raw.state || raw.home_state || raw.region,
      country: raw.country || raw.home_country || 'USA',
      zipCode: raw.zip || raw.postal_code || raw.zip_code,
      region: raw.geo_region || raw.territory,
      isInternational: (raw.country && raw.country !== 'USA' && raw.country !== 'United States') ||
        parseBoolean(raw.international) || false,
    };

    return {
      id: raw.id || raw.ref || raw.guid || '',
      firstName: raw.first || raw.first_name || raw.fname || '',
      lastName: raw.last || raw.last_name || raw.lname || '',
      email: raw.email || raw.email_address || '',
      applicationStatus: mapApplicationStatus(raw.app_status || raw.application_status || raw.status),
      admitType: mapAdmitType(raw.admit_type || raw.student_type || raw.level),
      enrollmentStatus: mapEnrollmentStatus(raw.enrollment_status || raw.enroll_status),
      entryTerm: raw.entry_term || raw.term || raw.admit_term || '',
      entryYear: parseInt(raw.entry_year || raw.year || raw.admit_year || '', 10) || new Date().getFullYear(),
      demographics,
      academicInfo,
      geographicInfo,
    };
  }
}

// Raw Slate data types (field names vary by institution)
interface RawSlateStudent {
  id?: string;
  ref?: string;
  guid?: string;
  first?: string;
  first_name?: string;
  fname?: string;
  last?: string;
  last_name?: string;
  lname?: string;
  email?: string;
  email_address?: string;
  gender?: string;
  sex?: string;
  ethnicity?: string;
  ethnic_code?: string;
  race?: string | string[];
  citizenship?: string;
  citizen?: string;
  first_gen?: string;
  first_generation?: string;
  legacy?: string;
  legacy_status?: string;
  veteran?: string;
  veteran_status?: string;
  birth_date?: string;
  dob?: string;
  major?: string;
  intended_major?: string;
  major_1?: string;
  college?: string;
  intended_college?: string;
  hs_gpa?: string;
  high_school_gpa?: string;
  transfer_gpa?: string;
  sat_total?: string;
  sat_composite?: string;
  sat_math?: string;
  sat_verbal?: string;
  sat_ebrw?: string;
  act_composite?: string;
  act?: string;
  hs_name?: string;
  high_school_name?: string;
  hs_city?: string;
  high_school_city?: string;
  hs_state?: string;
  high_school_state?: string;
  city?: string;
  home_city?: string;
  state?: string;
  home_state?: string;
  region?: string;
  country?: string;
  home_country?: string;
  zip?: string;
  postal_code?: string;
  zip_code?: string;
  geo_region?: string;
  territory?: string;
  international?: string;
  app_status?: string;
  application_status?: string;
  status?: string;
  admit_type?: string;
  student_type?: string;
  level?: string;
  enrollment_status?: string;
  enroll_status?: string;
  entry_term?: string;
  term?: string;
  admit_term?: string;
  entry_year?: string;
  year?: string;
  admit_year?: string;
}

interface RawFunnelData {
  prospects?: number;
  inquiries?: number;
  applicants?: number;
  admitted?: number;
  deposited?: number;
  enrolled?: number;
}

export interface FunnelData {
  entryYear: number;
  entryTerm: string;
  prospects: number;
  inquiries: number;
  applicants: number;
  admitted: number;
  deposited: number;
  enrolled: number;
}

// Helper functions
function parseBoolean(value: string | boolean | undefined): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const lower = value.toLowerCase();
  return lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1';
}

function mapApplicationStatus(status: string | undefined): ApplicationStatus {
  if (!status) return 'prospect';
  const lower = status.toLowerCase();
  if (lower.includes('admit') || lower.includes('accepted')) return 'admitted';
  if (lower.includes('deny') || lower.includes('denied') || lower.includes('reject')) return 'denied';
  if (lower.includes('wait')) return 'waitlisted';
  if (lower.includes('withdraw')) return 'withdrawn';
  if (lower.includes('appl') || lower.includes('complete')) return 'applicant';
  if (lower.includes('inquir')) return 'inquiry';
  return 'prospect';
}

function mapAdmitType(type: string | undefined): AdmitType {
  if (!type) return 'freshman';
  const lower = type.toLowerCase();
  if (lower.includes('transfer') || lower.includes('tr')) return 'transfer';
  if (lower.includes('grad')) return 'graduate';
  if (lower.includes('readmit')) return 'readmit';
  if (lower.includes('non') && lower.includes('degree')) return 'non-degree';
  return 'freshman';
}

function mapEnrollmentStatus(status: string | undefined): EnrollmentStatus {
  if (!status) return 'not_enrolled';
  const lower = status.toLowerCase();
  if (lower.includes('enroll') && !lower.includes('not')) return 'enrolled';
  if (lower.includes('deposit')) return 'deposited';
  if (lower.includes('defer')) return 'deferred';
  if (lower.includes('withdraw')) return 'withdrawn';
  return 'not_enrolled';
}
