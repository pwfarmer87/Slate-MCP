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
