/**
 * Type definitions for Student Course Feedback System
 */

// Course information
export interface Course {
  id: string;
  code: string;          // e.g., "CS101"
  name: string;          // e.g., "Introduction to Computer Science"
  department: string;    // e.g., "Computer Science"
  term: string;          // e.g., "Fall 2024"
  year: number;
  instructorId: string;
  instructorName: string;
}

// Rating categories with 1-5 scale
export interface FeedbackRatings {
  overall: number;              // Overall course satisfaction (1-5)
  contentQuality: number;       // Quality of course content (1-5)
  instructorEffectiveness: number; // Instructor teaching effectiveness (1-5)
  courseDifficulty: number;     // Difficulty level (1=too easy, 5=too hard, 3=appropriate)
  workloadManageability: number; // Workload manageability (1-5)
  learningOutcomes: number;     // Achieved learning outcomes (1-5)
  materialsQuality: number;     // Quality of course materials (1-5)
  engagementLevel: number;      // Class engagement/interaction (1-5)
}

// Individual feedback submission
export interface CourseFeedback {
  id: string;
  courseId: string;
  studentId: string;           // Anonymized student identifier
  submittedAt: string;         // ISO timestamp
  ratings: FeedbackRatings;
  comments: FeedbackComments;
  wouldRecommend: boolean;
  anonymous: boolean;
}

// Text feedback comments
export interface FeedbackComments {
  strengths?: string;          // What worked well
  improvements?: string;       // Areas for improvement
  instructorFeedback?: string; // Specific instructor feedback
  additionalComments?: string; // Any other comments
}

// Aggregated feedback summary for a course
export interface CourseFeedbackSummary {
  courseId: string;
  courseCode: string;
  courseName: string;
  instructorName: string;
  term: string;
  year: number;
  totalResponses: number;
  responseRate?: number;        // If enrollment known
  averageRatings: FeedbackRatings;
  ratingDistributions: {
    [K in keyof FeedbackRatings]: Record<number, number>; // Count per rating value
  };
  recommendationRate: number;   // Percentage who would recommend
  sentimentAnalysis: SentimentSummary;
  generatedAt: string;
}

// Sentiment analysis of text comments
export interface SentimentSummary {
  overallSentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  sentimentScore: number;       // -1 to 1
  topStrengths: string[];       // Common positive themes
  topImprovements: string[];    // Common improvement suggestions
  wordCloud: { word: string; count: number }[];
}

// Instructor feedback summary across courses
export interface InstructorFeedbackSummary {
  instructorId: string;
  instructorName: string;
  totalCourses: number;
  totalResponses: number;
  overallAverageRating: number;
  averageEffectiveness: number;
  courseBreakdown: {
    courseId: string;
    courseCode: string;
    courseName: string;
    term: string;
    averageRating: number;
    responseCount: number;
  }[];
  trendOverTime: {
    term: string;
    averageRating: number;
    responseCount: number;
  }[];
}

// Department feedback summary
export interface DepartmentFeedbackSummary {
  department: string;
  term: string;
  year: number;
  totalCourses: number;
  totalResponses: number;
  averageOverallRating: number;
  topRatedCourses: {
    courseCode: string;
    courseName: string;
    averageRating: number;
  }[];
  lowestRatedCourses: {
    courseCode: string;
    courseName: string;
    averageRating: number;
  }[];
  ratingDistribution: Record<number, number>;
}

// Feedback trends over time
export interface FeedbackTrends {
  courseId?: string;
  instructorId?: string;
  department?: string;
  timeRange: {
    startTerm: string;
    startYear: number;
    endTerm: string;
    endYear: number;
  };
  dataPoints: {
    term: string;
    year: number;
    averageRating: number;
    responseCount: number;
    recommendationRate: number;
  }[];
  overallTrend: 'improving' | 'stable' | 'declining';
  percentageChange: number;
}

// Search/filter parameters for feedback queries
export interface FeedbackQueryParams {
  courseId?: string;
  courseCode?: string;
  instructorId?: string;
  instructorName?: string;
  department?: string;
  term?: string;
  year?: number;
  minRating?: number;
  maxRating?: number;
  hasComments?: boolean;
  limit?: number;
  offset?: number;
}

// Feedback submission request
export interface SubmitFeedbackRequest {
  courseId: string;
  studentId: string;
  ratings: FeedbackRatings;
  comments?: FeedbackComments;
  wouldRecommend: boolean;
  anonymous?: boolean;
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Rating scale labels for display
export const RATING_LABELS: Record<keyof FeedbackRatings, { label: string; description: string }> = {
  overall: {
    label: 'Overall Satisfaction',
    description: 'Your overall satisfaction with this course',
  },
  contentQuality: {
    label: 'Content Quality',
    description: 'Quality and relevance of course content',
  },
  instructorEffectiveness: {
    label: 'Instructor Effectiveness',
    description: 'How effectively the instructor taught the material',
  },
  courseDifficulty: {
    label: 'Course Difficulty',
    description: 'Difficulty level (1=too easy, 3=appropriate, 5=too hard)',
  },
  workloadManageability: {
    label: 'Workload',
    description: 'How manageable was the course workload',
  },
  learningOutcomes: {
    label: 'Learning Outcomes',
    description: 'How well you achieved the stated learning objectives',
  },
  materialsQuality: {
    label: 'Materials Quality',
    description: 'Quality of textbooks, readings, and other materials',
  },
  engagementLevel: {
    label: 'Engagement',
    description: 'Level of interaction and engagement in class',
  },
};
