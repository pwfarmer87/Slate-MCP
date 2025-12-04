/**
 * Feedback Store Module
 * Handles storage and retrieval of course feedback data
 *
 * Note: This implementation uses in-memory storage with optional file persistence.
 * For production, integrate with your institution's database or Slate instance.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Course,
  CourseFeedback,
  FeedbackRatings,
  SubmitFeedbackRequest,
  FeedbackQueryParams,
  ValidationResult,
} from './feedback-types.js';

export class FeedbackStore {
  private courses: Map<string, Course> = new Map();
  private feedback: Map<string, CourseFeedback> = new Map();
  private dataFilePath: string | null = null;

  constructor(dataFilePath?: string) {
    this.dataFilePath = dataFilePath || null;
    if (this.dataFilePath) {
      this.loadFromFile();
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate feedback ratings
   */
  validateRatings(ratings: FeedbackRatings): ValidationResult {
    const errors: string[] = [];
    const ratingFields: (keyof FeedbackRatings)[] = [
      'overall',
      'contentQuality',
      'instructorEffectiveness',
      'courseDifficulty',
      'workloadManageability',
      'learningOutcomes',
      'materialsQuality',
      'engagementLevel',
    ];

    for (const field of ratingFields) {
      const value = ratings[field];
      if (value === undefined || value === null) {
        errors.push(`Missing required rating: ${field}`);
      } else if (typeof value !== 'number' || value < 1 || value > 5 || !Number.isInteger(value)) {
        errors.push(`Invalid rating for ${field}: must be an integer between 1 and 5`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Add or update a course
   */
  addCourse(course: Course): Course {
    this.courses.set(course.id, course);
    this.saveToFile();
    return course;
  }

  /**
   * Get a course by ID
   */
  getCourse(courseId: string): Course | undefined {
    return this.courses.get(courseId);
  }

  /**
   * Get a course by code and term
   */
  getCourseByCode(code: string, term: string, year: number): Course | undefined {
    for (const course of this.courses.values()) {
      if (course.code === code && course.term === term && course.year === year) {
        return course;
      }
    }
    return undefined;
  }

  /**
   * Get all courses
   */
  getAllCourses(): Course[] {
    return Array.from(this.courses.values());
  }

  /**
   * Get courses by department
   */
  getCoursesByDepartment(department: string, term?: string, year?: number): Course[] {
    return Array.from(this.courses.values()).filter(course => {
      if (course.department.toLowerCase() !== department.toLowerCase()) return false;
      if (term && course.term !== term) return false;
      if (year && course.year !== year) return false;
      return true;
    });
  }

  /**
   * Get courses by instructor
   */
  getCoursesByInstructor(instructorId: string): Course[] {
    return Array.from(this.courses.values()).filter(
      course => course.instructorId === instructorId
    );
  }

  /**
   * Submit new feedback
   */
  submitFeedback(request: SubmitFeedbackRequest): CourseFeedback | ValidationResult {
    // Validate ratings
    const validation = this.validateRatings(request.ratings);
    if (!validation.valid) {
      return validation;
    }

    // Check if course exists
    const course = this.getCourse(request.courseId);
    if (!course) {
      return {
        valid: false,
        errors: [`Course not found: ${request.courseId}`],
      };
    }

    // Check for duplicate submission (one feedback per student per course)
    const existingFeedback = this.getFeedbackByStudentAndCourse(
      request.studentId,
      request.courseId
    );
    if (existingFeedback) {
      return {
        valid: false,
        errors: ['You have already submitted feedback for this course'],
      };
    }

    const feedback: CourseFeedback = {
      id: this.generateId(),
      courseId: request.courseId,
      studentId: request.studentId,
      submittedAt: new Date().toISOString(),
      ratings: request.ratings,
      comments: request.comments || {},
      wouldRecommend: request.wouldRecommend,
      anonymous: request.anonymous ?? true,
    };

    this.feedback.set(feedback.id, feedback);
    this.saveToFile();
    return feedback;
  }

  /**
   * Get feedback by ID
   */
  getFeedback(feedbackId: string): CourseFeedback | undefined {
    return this.feedback.get(feedbackId);
  }

  /**
   * Get feedback by student and course
   */
  getFeedbackByStudentAndCourse(
    studentId: string,
    courseId: string
  ): CourseFeedback | undefined {
    for (const fb of this.feedback.values()) {
      if (fb.studentId === studentId && fb.courseId === courseId) {
        return fb;
      }
    }
    return undefined;
  }

  /**
   * Get all feedback for a course
   */
  getFeedbackByCourse(courseId: string): CourseFeedback[] {
    return Array.from(this.feedback.values()).filter(
      fb => fb.courseId === courseId
    );
  }

  /**
   * Get all feedback for an instructor (across all their courses)
   */
  getFeedbackByInstructor(instructorId: string): CourseFeedback[] {
    const instructorCourses = this.getCoursesByInstructor(instructorId);
    const courseIds = new Set(instructorCourses.map(c => c.id));
    return Array.from(this.feedback.values()).filter(fb =>
      courseIds.has(fb.courseId)
    );
  }

  /**
   * Get feedback by department
   */
  getFeedbackByDepartment(
    department: string,
    term?: string,
    year?: number
  ): CourseFeedback[] {
    const deptCourses = this.getCoursesByDepartment(department, term, year);
    const courseIds = new Set(deptCourses.map(c => c.id));
    return Array.from(this.feedback.values()).filter(fb =>
      courseIds.has(fb.courseId)
    );
  }

  /**
   * Query feedback with multiple filters
   */
  queryFeedback(params: FeedbackQueryParams): CourseFeedback[] {
    let results = Array.from(this.feedback.values());

    if (params.courseId) {
      results = results.filter(fb => fb.courseId === params.courseId);
    }

    if (params.courseCode) {
      const matchingCourses = Array.from(this.courses.values())
        .filter(c => c.code.toLowerCase() === params.courseCode!.toLowerCase())
        .map(c => c.id);
      results = results.filter(fb => matchingCourses.includes(fb.courseId));
    }

    if (params.instructorId) {
      const instructorCourses = this.getCoursesByInstructor(params.instructorId);
      const courseIds = new Set(instructorCourses.map(c => c.id));
      results = results.filter(fb => courseIds.has(fb.courseId));
    }

    if (params.instructorName) {
      const matchingCourses = Array.from(this.courses.values())
        .filter(c =>
          c.instructorName.toLowerCase().includes(params.instructorName!.toLowerCase())
        )
        .map(c => c.id);
      results = results.filter(fb => matchingCourses.includes(fb.courseId));
    }

    if (params.department) {
      const deptCourses = this.getCoursesByDepartment(
        params.department,
        params.term,
        params.year
      );
      const courseIds = new Set(deptCourses.map(c => c.id));
      results = results.filter(fb => courseIds.has(fb.courseId));
    }

    if (params.term || params.year) {
      const matchingCourses = Array.from(this.courses.values())
        .filter(c => {
          if (params.term && c.term !== params.term) return false;
          if (params.year && c.year !== params.year) return false;
          return true;
        })
        .map(c => c.id);
      results = results.filter(fb => matchingCourses.includes(fb.courseId));
    }

    if (params.minRating !== undefined) {
      results = results.filter(fb => fb.ratings.overall >= params.minRating!);
    }

    if (params.maxRating !== undefined) {
      results = results.filter(fb => fb.ratings.overall <= params.maxRating!);
    }

    if (params.hasComments) {
      results = results.filter(
        fb =>
          fb.comments.strengths ||
          fb.comments.improvements ||
          fb.comments.instructorFeedback ||
          fb.comments.additionalComments
      );
    }

    // Apply pagination
    const offset = params.offset || 0;
    const limit = params.limit || 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get unique terms from all courses
   */
  getAvailableTerms(): { term: string; year: number }[] {
    const terms = new Map<string, { term: string; year: number }>();
    for (const course of this.courses.values()) {
      const key = `${course.term}-${course.year}`;
      if (!terms.has(key)) {
        terms.set(key, { term: course.term, year: course.year });
      }
    }
    return Array.from(terms.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return a.term.localeCompare(b.term);
    });
  }

  /**
   * Get unique departments
   */
  getAvailableDepartments(): string[] {
    const departments = new Set<string>();
    for (const course of this.courses.values()) {
      departments.add(course.department);
    }
    return Array.from(departments).sort();
  }

  /**
   * Get unique instructors
   */
  getAvailableInstructors(): { id: string; name: string }[] {
    const instructors = new Map<string, string>();
    for (const course of this.courses.values()) {
      if (!instructors.has(course.instructorId)) {
        instructors.set(course.instructorId, course.instructorName);
      }
    }
    return Array.from(instructors.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get total feedback count
   */
  getTotalFeedbackCount(): number {
    return this.feedback.size;
  }

  /**
   * Get total course count
   */
  getTotalCourseCount(): number {
    return this.courses.size;
  }

  /**
   * Delete feedback by ID
   */
  deleteFeedback(feedbackId: string): boolean {
    const deleted = this.feedback.delete(feedbackId);
    if (deleted) {
      this.saveToFile();
    }
    return deleted;
  }

  /**
   * Delete a course and all associated feedback
   */
  deleteCourse(courseId: string): boolean {
    const course = this.courses.get(courseId);
    if (!course) return false;

    // Delete all feedback for this course
    for (const [id, fb] of this.feedback.entries()) {
      if (fb.courseId === courseId) {
        this.feedback.delete(id);
      }
    }

    this.courses.delete(courseId);
    this.saveToFile();
    return true;
  }

  /**
   * Save data to file
   */
  private saveToFile(): void {
    if (!this.dataFilePath) return;

    const data = {
      courses: Array.from(this.courses.entries()),
      feedback: Array.from(this.feedback.entries()),
    };

    try {
      const dir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save feedback data:', error);
    }
  }

  /**
   * Load data from file
   */
  private loadFromFile(): void {
    if (!this.dataFilePath || !fs.existsSync(this.dataFilePath)) return;

    try {
      const content = fs.readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(content);

      if (data.courses) {
        this.courses = new Map(data.courses);
      }
      if (data.feedback) {
        this.feedback = new Map(data.feedback);
      }
    } catch (error) {
      console.error('Failed to load feedback data:', error);
    }
  }

  /**
   * Seed with sample data for testing
   */
  seedSampleData(): void {
    // Sample courses
    const sampleCourses: Course[] = [
      {
        id: 'cs101-f24',
        code: 'CS101',
        name: 'Introduction to Computer Science',
        department: 'Computer Science',
        term: 'Fall',
        year: 2024,
        instructorId: 'prof-smith',
        instructorName: 'Dr. Jane Smith',
      },
      {
        id: 'cs201-f24',
        code: 'CS201',
        name: 'Data Structures',
        department: 'Computer Science',
        term: 'Fall',
        year: 2024,
        instructorId: 'prof-johnson',
        instructorName: 'Dr. Robert Johnson',
      },
      {
        id: 'math101-f24',
        code: 'MATH101',
        name: 'Calculus I',
        department: 'Mathematics',
        term: 'Fall',
        year: 2024,
        instructorId: 'prof-williams',
        instructorName: 'Dr. Emily Williams',
      },
      {
        id: 'eng101-f24',
        code: 'ENG101',
        name: 'English Composition',
        department: 'English',
        term: 'Fall',
        year: 2024,
        instructorId: 'prof-davis',
        instructorName: 'Dr. Michael Davis',
      },
      {
        id: 'cs101-s24',
        code: 'CS101',
        name: 'Introduction to Computer Science',
        department: 'Computer Science',
        term: 'Spring',
        year: 2024,
        instructorId: 'prof-smith',
        instructorName: 'Dr. Jane Smith',
      },
    ];

    for (const course of sampleCourses) {
      this.addCourse(course);
    }

    // Sample feedback
    const sampleFeedback: SubmitFeedbackRequest[] = [
      {
        courseId: 'cs101-f24',
        studentId: 'student-001',
        ratings: {
          overall: 5,
          contentQuality: 5,
          instructorEffectiveness: 5,
          courseDifficulty: 3,
          workloadManageability: 4,
          learningOutcomes: 5,
          materialsQuality: 4,
          engagementLevel: 5,
        },
        comments: {
          strengths: 'Dr. Smith explains concepts clearly and makes programming fun.',
          improvements: 'More hands-on projects would be helpful.',
        },
        wouldRecommend: true,
      },
      {
        courseId: 'cs101-f24',
        studentId: 'student-002',
        ratings: {
          overall: 4,
          contentQuality: 4,
          instructorEffectiveness: 5,
          courseDifficulty: 3,
          workloadManageability: 3,
          learningOutcomes: 4,
          materialsQuality: 4,
          engagementLevel: 4,
        },
        comments: {
          strengths: 'Great introduction to programming concepts.',
          improvements: 'Assignments could have clearer instructions.',
        },
        wouldRecommend: true,
      },
      {
        courseId: 'cs201-f24',
        studentId: 'student-001',
        ratings: {
          overall: 4,
          contentQuality: 5,
          instructorEffectiveness: 4,
          courseDifficulty: 4,
          workloadManageability: 3,
          learningOutcomes: 4,
          materialsQuality: 5,
          engagementLevel: 3,
        },
        comments: {
          strengths: 'Comprehensive coverage of data structures.',
          improvements: 'More examples during lectures would help.',
          instructorFeedback: 'Dr. Johnson is knowledgeable but sometimes goes too fast.',
        },
        wouldRecommend: true,
      },
      {
        courseId: 'math101-f24',
        studentId: 'student-003',
        ratings: {
          overall: 3,
          contentQuality: 4,
          instructorEffectiveness: 3,
          courseDifficulty: 4,
          workloadManageability: 2,
          learningOutcomes: 3,
          materialsQuality: 4,
          engagementLevel: 2,
        },
        comments: {
          strengths: 'Good textbook and online resources.',
          improvements: 'Need more office hours and practice problems.',
        },
        wouldRecommend: false,
      },
    ];

    for (const fb of sampleFeedback) {
      this.submitFeedback(fb);
    }
  }
}
