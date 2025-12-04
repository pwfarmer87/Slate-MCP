#!/usr/bin/env node

/**
 * Slate MCP Server
 * Connects Technolutions Slate with Claude for enrollment demographics reporting
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';

import { SlateClient, FunnelData } from './slate-client.js';
import {
  generateDemographicsSummary,
  generateDiversityMetrics,
  generateYearOverYearComparison,
  formatDemographicsReport,
} from './demographics.js';
import {
  SlateConfig,
  StudentRecord,
  EnrollmentDemographicsSummary,
  DiversityMetrics,
  YearOverYearComparison,
} from './types.js';
import {
  Course,
  CourseFeedback,
  FeedbackRatings,
  SubmitFeedbackRequest,
  FeedbackQueryParams,
  ValidationResult,
} from './feedback-types.js';
import { FeedbackStore } from './feedback-store.js';
import {
  generateCourseFeedbackSummary,
  generateInstructorFeedbackSummary,
  generateDepartmentFeedbackSummary,
  generateFeedbackTrends,
  formatCourseFeedbackReport,
  formatInstructorFeedbackReport,
  formatDepartmentFeedbackReport,
} from './feedback-analysis.js';

// Load configuration from environment variables
function loadConfig(): SlateConfig {
  const baseUrl = process.env.SLATE_BASE_URL;
  const username = process.env.SLATE_USERNAME;
  const password = process.env.SLATE_PASSWORD;
  const apiKey = process.env.SLATE_API_KEY;

  if (!baseUrl) {
    throw new Error('SLATE_BASE_URL environment variable is required');
  }

  if (!apiKey && (!username || !password)) {
    throw new Error(
      'Either SLATE_API_KEY or both SLATE_USERNAME and SLATE_PASSWORD are required'
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''), // Remove trailing slash
    username: username || '',
    password: password || '',
    apiKey,
  };
}

// Define available tools
const tools: Tool[] = [
  {
    name: 'get_enrollment_demographics',
    description:
      'Get a comprehensive demographics summary for enrolled students for a specific entry year. Returns data on gender, ethnicity, geographic distribution, first-generation status, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_year: {
          type: 'number',
          description: 'The entry year for the cohort (e.g., 2024)',
        },
        entry_term: {
          type: 'string',
          description: 'The entry term (e.g., "Fall", "Spring"). Defaults to "Fall".',
          default: 'Fall',
        },
      },
      required: ['entry_year'],
    },
  },
  {
    name: 'get_diversity_metrics',
    description:
      'Get detailed diversity metrics for an enrolled cohort, including diversity index, URM percentage, gender balance, and geographic diversity.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_year: {
          type: 'number',
          description: 'The entry year for the cohort (e.g., 2024)',
        },
        entry_term: {
          type: 'string',
          description: 'The entry term (e.g., "Fall", "Spring"). Defaults to "Fall".',
          default: 'Fall',
        },
      },
      required: ['entry_year'],
    },
  },
  {
    name: 'get_enrollment_funnel',
    description:
      'Get enrollment funnel data showing the progression from prospects to enrolled students for a specific year.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_year: {
          type: 'number',
          description: 'The entry year for the cohort (e.g., 2024)',
        },
        entry_term: {
          type: 'string',
          description: 'The entry term (e.g., "Fall", "Spring"). Defaults to "Fall".',
          default: 'Fall',
        },
      },
      required: ['entry_year'],
    },
  },
  {
    name: 'compare_enrollment_years',
    description:
      'Compare enrollment demographics across multiple years to identify trends and changes.',
    inputSchema: {
      type: 'object',
      properties: {
        years: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of years to compare (e.g., [2022, 2023, 2024])',
        },
        entry_term: {
          type: 'string',
          description: 'The entry term to compare (e.g., "Fall"). Defaults to "Fall".',
          default: 'Fall',
        },
      },
      required: ['years'],
    },
  },
  {
    name: 'get_demographics_report',
    description:
      'Generate a formatted, human-readable demographics report for a specific enrollment year.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_year: {
          type: 'number',
          description: 'The entry year for the cohort (e.g., 2024)',
        },
        entry_term: {
          type: 'string',
          description: 'The entry term (e.g., "Fall", "Spring"). Defaults to "Fall".',
          default: 'Fall',
        },
      },
      required: ['entry_year'],
    },
  },
  {
    name: 'get_demographics_by_category',
    description:
      'Get enrollment counts broken down by a specific demographic category.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_year: {
          type: 'number',
          description: 'The entry year for the cohort (e.g., 2024)',
        },
        category: {
          type: 'string',
          enum: [
            'gender',
            'ethnicity',
            'state',
            'country',
            'admit_type',
            'major',
            'college',
            'first_generation',
            'international',
          ],
          description: 'The demographic category to break down by',
        },
        entry_term: {
          type: 'string',
          description: 'The entry term (e.g., "Fall", "Spring"). Defaults to "Fall".',
          default: 'Fall',
        },
      },
      required: ['entry_year', 'category'],
    },
  },
  {
    name: 'search_students',
    description:
      'Search for students matching specific criteria. Returns demographic information for matching students.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_year: {
          type: 'number',
          description: 'Filter by entry year',
        },
        entry_term: {
          type: 'string',
          description: 'Filter by entry term',
        },
        state: {
          type: 'string',
          description: 'Filter by home state',
        },
        country: {
          type: 'string',
          description: 'Filter by home country',
        },
        major: {
          type: 'string',
          description: 'Filter by intended major (partial match)',
        },
        first_generation: {
          type: 'boolean',
          description: 'Filter by first-generation status',
        },
        international: {
          type: 'boolean',
          description: 'Filter by international status',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 100)',
          default: 100,
        },
      },
    },
  },
  // Student Feedback Tools
  {
    name: 'add_course',
    description:
      'Add a new course to the feedback system. Creates a course that students can submit feedback for.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Course code (e.g., "CS101")',
        },
        name: {
          type: 'string',
          description: 'Full course name (e.g., "Introduction to Computer Science")',
        },
        department: {
          type: 'string',
          description: 'Department offering the course (e.g., "Computer Science")',
        },
        term: {
          type: 'string',
          description: 'Term (e.g., "Fall", "Spring")',
        },
        year: {
          type: 'number',
          description: 'Academic year (e.g., 2024)',
        },
        instructor_name: {
          type: 'string',
          description: 'Name of the instructor',
        },
        instructor_id: {
          type: 'string',
          description: 'Unique identifier for the instructor',
        },
      },
      required: ['code', 'name', 'department', 'term', 'year', 'instructor_name'],
    },
  },
  {
    name: 'submit_feedback',
    description:
      'Submit student feedback for a course. Includes ratings (1-5 scale) across multiple dimensions and optional comments.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: 'string',
          description: 'The unique course ID to submit feedback for',
        },
        student_id: {
          type: 'string',
          description: 'Anonymous student identifier',
        },
        ratings: {
          type: 'object',
          description: 'Rating scores (1-5) for each category',
          properties: {
            overall: { type: 'number', description: 'Overall satisfaction (1-5)' },
            content_quality: { type: 'number', description: 'Content quality (1-5)' },
            instructor_effectiveness: { type: 'number', description: 'Instructor effectiveness (1-5)' },
            course_difficulty: { type: 'number', description: 'Difficulty level (1=too easy, 3=right, 5=too hard)' },
            workload_manageability: { type: 'number', description: 'Workload manageability (1-5)' },
            learning_outcomes: { type: 'number', description: 'Learning outcomes achieved (1-5)' },
            materials_quality: { type: 'number', description: 'Materials quality (1-5)' },
            engagement_level: { type: 'number', description: 'Class engagement (1-5)' },
          },
          required: ['overall', 'content_quality', 'instructor_effectiveness', 'course_difficulty', 'workload_manageability', 'learning_outcomes', 'materials_quality', 'engagement_level'],
        },
        comments: {
          type: 'object',
          description: 'Optional text feedback',
          properties: {
            strengths: { type: 'string', description: 'What worked well in the course' },
            improvements: { type: 'string', description: 'Areas for improvement' },
            instructor_feedback: { type: 'string', description: 'Specific instructor feedback' },
            additional_comments: { type: 'string', description: 'Any other comments' },
          },
        },
        would_recommend: {
          type: 'boolean',
          description: 'Would the student recommend this course?',
        },
        anonymous: {
          type: 'boolean',
          description: 'Submit feedback anonymously (default: true)',
          default: true,
        },
      },
      required: ['course_id', 'student_id', 'ratings', 'would_recommend'],
    },
  },
  {
    name: 'get_course_feedback_summary',
    description:
      'Get a comprehensive feedback summary for a specific course, including average ratings, sentiment analysis, and key themes.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: 'string',
          description: 'The course ID to get feedback for',
        },
      },
      required: ['course_id'],
    },
  },
  {
    name: 'get_course_feedback_report',
    description:
      'Generate a formatted, human-readable feedback report for a specific course.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: 'string',
          description: 'The course ID to generate a report for',
        },
      },
      required: ['course_id'],
    },
  },
  {
    name: 'get_instructor_feedback_summary',
    description:
      'Get feedback summary for an instructor across all their courses, including performance trends over time.',
    inputSchema: {
      type: 'object',
      properties: {
        instructor_id: {
          type: 'string',
          description: 'The instructor ID to get feedback for',
        },
      },
      required: ['instructor_id'],
    },
  },
  {
    name: 'get_department_feedback_summary',
    description:
      'Get aggregated feedback summary for an entire department, including top and lowest-rated courses.',
    inputSchema: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          description: 'Department name to get feedback for',
        },
        term: {
          type: 'string',
          description: 'Filter by term (e.g., "Fall")',
        },
        year: {
          type: 'number',
          description: 'Filter by year',
        },
      },
      required: ['department'],
    },
  },
  {
    name: 'get_feedback_trends',
    description:
      'Analyze feedback trends over time for a course, instructor, or department.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: 'string',
          description: 'Course ID to analyze trends for',
        },
        instructor_id: {
          type: 'string',
          description: 'Instructor ID to analyze trends for',
        },
        department: {
          type: 'string',
          description: 'Department to analyze trends for',
        },
      },
    },
  },
  {
    name: 'list_courses',
    description:
      'List all courses in the feedback system, optionally filtered by department, term, or instructor.',
    inputSchema: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          description: 'Filter by department',
        },
        term: {
          type: 'string',
          description: 'Filter by term',
        },
        year: {
          type: 'number',
          description: 'Filter by year',
        },
        instructor_id: {
          type: 'string',
          description: 'Filter by instructor ID',
        },
      },
    },
  },
  {
    name: 'search_feedback',
    description:
      'Search and filter feedback submissions with various criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: 'string',
          description: 'Filter by course ID',
        },
        course_code: {
          type: 'string',
          description: 'Filter by course code',
        },
        instructor_id: {
          type: 'string',
          description: 'Filter by instructor ID',
        },
        department: {
          type: 'string',
          description: 'Filter by department',
        },
        term: {
          type: 'string',
          description: 'Filter by term',
        },
        year: {
          type: 'number',
          description: 'Filter by year',
        },
        min_rating: {
          type: 'number',
          description: 'Minimum overall rating (1-5)',
        },
        max_rating: {
          type: 'number',
          description: 'Maximum overall rating (1-5)',
        },
        has_comments: {
          type: 'boolean',
          description: 'Only return feedback with comments',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 100)',
          default: 100,
        },
      },
    },
  },
  {
    name: 'get_feedback_stats',
    description:
      'Get overall statistics about the feedback system including total courses, responses, and available filters.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'seed_sample_feedback_data',
    description:
      'Seed the feedback system with sample course and feedback data for testing and demonstration purposes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Create the server
const server = new Server(
  {
    name: 'slate-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let slateClient: SlateClient | null = null;

// Initialize the Feedback store
const feedbackDataPath = process.env.FEEDBACK_DATA_PATH || undefined;
const feedbackStore = new FeedbackStore(feedbackDataPath);

// Initialize the Slate client
function getSlateClient(): SlateClient {
  if (!slateClient) {
    const config = loadConfig();
    slateClient = new SlateClient(config);
  }
  return slateClient;
}

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const client = getSlateClient();
    let result: unknown;

    switch (name) {
      case 'get_enrollment_demographics': {
        const entryYear = args?.entry_year as number;
        const entryTerm = (args?.entry_term as string) || 'Fall';

        const students = await client.getEnrolledStudents(entryYear, entryTerm);
        const summary = generateDemographicsSummary(students, entryYear, entryTerm);
        result = summary;
        break;
      }

      case 'get_diversity_metrics': {
        const entryYear = args?.entry_year as number;
        const entryTerm = (args?.entry_term as string) || 'Fall';

        const students = await client.getEnrolledStudents(entryYear, entryTerm);
        const metrics = generateDiversityMetrics(students, entryYear);
        result = metrics;
        break;
      }

      case 'get_enrollment_funnel': {
        const entryYear = args?.entry_year as number;
        const entryTerm = (args?.entry_term as string) || 'Fall';

        const funnel = await client.getFunnelData(entryYear, entryTerm);
        result = {
          ...funnel,
          conversionRates: {
            inquiryToApplicant:
              funnel.inquiries > 0
                ? `${((funnel.applicants / funnel.inquiries) * 100).toFixed(1)}%`
                : 'N/A',
            applicantToAdmit:
              funnel.applicants > 0
                ? `${((funnel.admitted / funnel.applicants) * 100).toFixed(1)}%`
                : 'N/A',
            admitToDeposit:
              funnel.admitted > 0
                ? `${((funnel.deposited / funnel.admitted) * 100).toFixed(1)}%`
                : 'N/A',
            depositToEnroll:
              funnel.deposited > 0
                ? `${((funnel.enrolled / funnel.deposited) * 100).toFixed(1)}%`
                : 'N/A',
            overallYield:
              funnel.admitted > 0
                ? `${((funnel.enrolled / funnel.admitted) * 100).toFixed(1)}%`
                : 'N/A',
          },
        };
        break;
      }

      case 'compare_enrollment_years': {
        const years = args?.years as number[];
        const entryTerm = (args?.entry_term as string) || 'Fall';

        const studentsByYear = new Map<number, StudentRecord[]>();
        for (const year of years) {
          const students = await client.getEnrolledStudents(year, entryTerm);
          studentsByYear.set(year, students);
        }

        const comparison = generateYearOverYearComparison(studentsByYear);
        result = comparison;
        break;
      }

      case 'get_demographics_report': {
        const entryYear = args?.entry_year as number;
        const entryTerm = (args?.entry_term as string) || 'Fall';

        const students = await client.getEnrolledStudents(entryYear, entryTerm);
        const summary = generateDemographicsSummary(students, entryYear, entryTerm);
        const report = formatDemographicsReport(summary);
        result = { report, rawData: summary };
        break;
      }

      case 'get_demographics_by_category': {
        const entryYear = args?.entry_year as number;
        const category = args?.category as string;
        const entryTerm = (args?.entry_term as string) || 'Fall';

        const students = await client.getEnrolledStudents(entryYear, entryTerm);
        const enrolled = students.filter(
          (s) => s.enrollmentStatus === 'enrolled' || s.enrollmentStatus === 'deposited'
        );

        let breakdown: Record<string, number> = {};
        const total = enrolled.length;

        switch (category) {
          case 'gender':
            breakdown = aggregateStudents(enrolled, (s) => s.demographics.gender || 'Not Reported');
            break;
          case 'ethnicity':
            breakdown = aggregateStudents(enrolled, (s) => s.demographics.ethnicity || 'Not Reported');
            break;
          case 'state':
            breakdown = aggregateStudents(enrolled, (s) => s.geographicInfo.state || 'Not Reported');
            break;
          case 'country':
            breakdown = aggregateStudents(enrolled, (s) => s.geographicInfo.country || 'Not Reported');
            break;
          case 'admit_type':
            breakdown = aggregateStudents(enrolled, (s) => s.admitType);
            break;
          case 'major':
            breakdown = aggregateStudents(enrolled, (s) => s.academicInfo.intendedMajor || 'Undeclared');
            break;
          case 'college':
            breakdown = aggregateStudents(enrolled, (s) => s.academicInfo.intendedCollege || 'Not Specified');
            break;
          case 'first_generation':
            breakdown = {
              'First Generation': enrolled.filter((s) => s.demographics.firstGeneration === true).length,
              'Not First Generation': enrolled.filter((s) => s.demographics.firstGeneration === false).length,
              'Not Reported': enrolled.filter((s) => s.demographics.firstGeneration === undefined).length,
            };
            break;
          case 'international':
            breakdown = {
              International: enrolled.filter((s) => s.geographicInfo.isInternational).length,
              Domestic: enrolled.filter((s) => !s.geographicInfo.isInternational).length,
            };
            break;
        }

        // Calculate percentages
        const withPercentages = Object.entries(breakdown)
          .map(([key, count]) => ({
            category: key,
            count,
            percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
          }))
          .sort((a, b) => b.count - a.count);

        result = {
          entryYear,
          entryTerm,
          category,
          total,
          breakdown: withPercentages,
        };
        break;
      }

      case 'search_students': {
        const entryYear = args?.entry_year as number | undefined;
        const entryTerm = args?.entry_term as string | undefined;
        const state = args?.state as string | undefined;
        const country = args?.country as string | undefined;
        const major = args?.major as string | undefined;
        const firstGeneration = args?.first_generation as boolean | undefined;
        const international = args?.international as boolean | undefined;
        const limit = (args?.limit as number) || 100;

        // Get students - if no year specified, get current year
        const year = entryYear || new Date().getFullYear();
        let students = await client.getEnrolledStudents(year, entryTerm);

        // Apply filters
        if (state) {
          students = students.filter(
            (s) => s.geographicInfo.state?.toLowerCase() === state.toLowerCase()
          );
        }
        if (country) {
          students = students.filter(
            (s) => s.geographicInfo.country?.toLowerCase() === country.toLowerCase()
          );
        }
        if (major) {
          students = students.filter((s) =>
            s.academicInfo.intendedMajor?.toLowerCase().includes(major.toLowerCase())
          );
        }
        if (firstGeneration !== undefined) {
          students = students.filter((s) => s.demographics.firstGeneration === firstGeneration);
        }
        if (international !== undefined) {
          students = students.filter((s) => s.geographicInfo.isInternational === international);
        }

        // Limit results and anonymize
        const limitedStudents = students.slice(0, limit).map((s) => ({
          id: s.id,
          entryYear: s.entryYear,
          entryTerm: s.entryTerm,
          admitType: s.admitType,
          enrollmentStatus: s.enrollmentStatus,
          demographics: {
            gender: s.demographics.gender,
            ethnicity: s.demographics.ethnicity,
            firstGeneration: s.demographics.firstGeneration,
          },
          academicInfo: {
            intendedMajor: s.academicInfo.intendedMajor,
            intendedCollege: s.academicInfo.intendedCollege,
          },
          geographicInfo: {
            state: s.geographicInfo.state,
            country: s.geographicInfo.country,
            isInternational: s.geographicInfo.isInternational,
          },
        }));

        result = {
          totalMatching: students.length,
          returned: limitedStudents.length,
          students: limitedStudents,
        };
        break;
      }

      // Student Feedback Tool Handlers
      case 'add_course': {
        const code = args?.code as string;
        const courseName = args?.name as string;
        const department = args?.department as string;
        const term = args?.term as string;
        const year = args?.year as number;
        const instructorName = args?.instructor_name as string;
        const instructorId = (args?.instructor_id as string) || `instructor-${instructorName.toLowerCase().replace(/\s+/g, '-')}`;

        const courseId = `${code.toLowerCase()}-${term.toLowerCase().charAt(0)}${year}`;
        const course: Course = {
          id: courseId,
          code,
          name: courseName,
          department,
          term,
          year,
          instructorId,
          instructorName,
        };

        const addedCourse = feedbackStore.addCourse(course);
        result = {
          success: true,
          message: `Course ${code} added successfully`,
          course: addedCourse,
        };
        break;
      }

      case 'submit_feedback': {
        const courseId = args?.course_id as string;
        const studentId = args?.student_id as string;
        const ratingsInput = args?.ratings as Record<string, number>;
        const commentsInput = args?.comments as Record<string, string> | undefined;
        const wouldRecommend = args?.would_recommend as boolean;
        const anonymous = (args?.anonymous as boolean) ?? true;

        // Map snake_case to camelCase for ratings
        const ratings: FeedbackRatings = {
          overall: ratingsInput.overall,
          contentQuality: ratingsInput.content_quality,
          instructorEffectiveness: ratingsInput.instructor_effectiveness,
          courseDifficulty: ratingsInput.course_difficulty,
          workloadManageability: ratingsInput.workload_manageability,
          learningOutcomes: ratingsInput.learning_outcomes,
          materialsQuality: ratingsInput.materials_quality,
          engagementLevel: ratingsInput.engagement_level,
        };

        const comments = commentsInput ? {
          strengths: commentsInput.strengths,
          improvements: commentsInput.improvements,
          instructorFeedback: commentsInput.instructor_feedback,
          additionalComments: commentsInput.additional_comments,
        } : undefined;

        const feedbackResult = feedbackStore.submitFeedback({
          courseId,
          studentId,
          ratings,
          comments,
          wouldRecommend,
          anonymous,
        });

        if ('valid' in feedbackResult && !feedbackResult.valid) {
          result = {
            success: false,
            errors: (feedbackResult as ValidationResult).errors,
          };
        } else {
          result = {
            success: true,
            message: 'Feedback submitted successfully',
            feedback: feedbackResult,
          };
        }
        break;
      }

      case 'get_course_feedback_summary': {
        const courseId = args?.course_id as string;
        const summary = generateCourseFeedbackSummary(feedbackStore, courseId);

        if (!summary) {
          result = { error: `Course not found: ${courseId}` };
        } else {
          result = summary;
        }
        break;
      }

      case 'get_course_feedback_report': {
        const courseId = args?.course_id as string;
        const summary = generateCourseFeedbackSummary(feedbackStore, courseId);

        if (!summary) {
          result = { error: `Course not found: ${courseId}` };
        } else {
          const report = formatCourseFeedbackReport(summary);
          result = { report, rawData: summary };
        }
        break;
      }

      case 'get_instructor_feedback_summary': {
        const instructorId = args?.instructor_id as string;
        const summary = generateInstructorFeedbackSummary(feedbackStore, instructorId);

        if (!summary) {
          result = { error: `Instructor not found or no courses: ${instructorId}` };
        } else {
          const report = formatInstructorFeedbackReport(summary);
          result = { report, rawData: summary };
        }
        break;
      }

      case 'get_department_feedback_summary': {
        const department = args?.department as string;
        const term = args?.term as string | undefined;
        const year = args?.year as number | undefined;

        const summary = generateDepartmentFeedbackSummary(feedbackStore, department, term, year);

        if (!summary) {
          result = { error: `Department not found or no courses: ${department}` };
        } else {
          const report = formatDepartmentFeedbackReport(summary);
          result = { report, rawData: summary };
        }
        break;
      }

      case 'get_feedback_trends': {
        const courseId = args?.course_id as string | undefined;
        const instructorId = args?.instructor_id as string | undefined;
        const department = args?.department as string | undefined;

        if (!courseId && !instructorId && !department) {
          result = { error: 'At least one of course_id, instructor_id, or department must be provided' };
        } else {
          const trends = generateFeedbackTrends(feedbackStore, { courseId, instructorId, department });
          if (!trends) {
            result = { error: 'No feedback data found for the specified criteria' };
          } else {
            result = trends;
          }
        }
        break;
      }

      case 'list_courses': {
        const department = args?.department as string | undefined;
        const term = args?.term as string | undefined;
        const year = args?.year as number | undefined;
        const instructorId = args?.instructor_id as string | undefined;

        let courses: Course[];

        if (instructorId) {
          courses = feedbackStore.getCoursesByInstructor(instructorId);
        } else if (department) {
          courses = feedbackStore.getCoursesByDepartment(department, term, year);
        } else {
          courses = feedbackStore.getAllCourses();
        }

        // Apply additional filters
        if (term && !department) {
          courses = courses.filter(c => c.term === term);
        }
        if (year && !department) {
          courses = courses.filter(c => c.year === year);
        }

        result = {
          totalCourses: courses.length,
          courses: courses.map(c => ({
            id: c.id,
            code: c.code,
            name: c.name,
            department: c.department,
            term: c.term,
            year: c.year,
            instructorName: c.instructorName,
          })),
        };
        break;
      }

      case 'search_feedback': {
        const queryParams: FeedbackQueryParams = {
          courseId: args?.course_id as string | undefined,
          courseCode: args?.course_code as string | undefined,
          instructorId: args?.instructor_id as string | undefined,
          department: args?.department as string | undefined,
          term: args?.term as string | undefined,
          year: args?.year as number | undefined,
          minRating: args?.min_rating as number | undefined,
          maxRating: args?.max_rating as number | undefined,
          hasComments: args?.has_comments as boolean | undefined,
          limit: (args?.limit as number) || 100,
        };

        const feedbackResults = feedbackStore.queryFeedback(queryParams);

        // Anonymize feedback for display
        const anonymizedResults = feedbackResults.map(fb => ({
          id: fb.id,
          courseId: fb.courseId,
          submittedAt: fb.submittedAt,
          ratings: fb.ratings,
          comments: fb.anonymous ? {
            strengths: fb.comments.strengths,
            improvements: fb.comments.improvements,
          } : fb.comments,
          wouldRecommend: fb.wouldRecommend,
        }));

        result = {
          totalResults: anonymizedResults.length,
          feedback: anonymizedResults,
        };
        break;
      }

      case 'get_feedback_stats': {
        const stats = {
          totalCourses: feedbackStore.getTotalCourseCount(),
          totalFeedbackSubmissions: feedbackStore.getTotalFeedbackCount(),
          availableTerms: feedbackStore.getAvailableTerms(),
          availableDepartments: feedbackStore.getAvailableDepartments(),
          availableInstructors: feedbackStore.getAvailableInstructors(),
        };
        result = stats;
        break;
      }

      case 'seed_sample_feedback_data': {
        feedbackStore.seedSampleData();
        result = {
          success: true,
          message: 'Sample feedback data has been seeded successfully',
          stats: {
            totalCourses: feedbackStore.getTotalCourseCount(),
            totalFeedbackSubmissions: feedbackStore.getTotalFeedbackCount(),
          },
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const content: TextContent[] = [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ];

    return { content };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Helper function for aggregation
function aggregateStudents(
  students: StudentRecord[],
  keyFn: (s: StudentRecord) => string
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const student of students) {
    const key = keyFn(student);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Slate MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
