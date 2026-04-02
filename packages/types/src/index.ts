// ─── Job / Search ────────────────────────────────────────────

export interface JobLocation {
  address?: string;
  addressKind: 'city' | 'country' | 'global';
  workType: 'remote' | 'onsite' | 'hybrid';
}

export interface Job {
  jobId: string;
  title: string;
  company: string;
  applyUrl: string;
  requiredSkills: string[];
  minExperience: number;
  locations: JobLocation[];
}

export interface JobMatch extends Job {
  conformancePercentage: number;
  agentNotes?: string;
  needsHumanReview: boolean;
}

// ─── User ────────────────────────────────────────────────────

export interface UserPreferences {
  excludedSkills?: string[];
  excludedCompanies?: string[];
  preferredRoles?: string[];
  preferredRegions?: string[];
  excludedRegions?: string[];
  remoteOnly?: boolean;
  [key: string]: unknown;
}

export type UserPlan = 'free' | 'pro';

export interface UserProfile {
  id: number;
  telegramUserId: number;
  cvUrl: string | null;
  cvHash: string | null;
  profile: CandidateProfile | null;
  preferences: UserPreferences;
  scheduleHour: number;
  region: string;
  plan: UserPlan;
  onboarded: boolean;
}

// ─── Candidate ───────────────────────────────────────────────

export interface CandidateProfile {
  name: string;
  preferredRole: string;
  summary: string;
  email?: string;
  links: Array<{ title?: string; url: string }>;
  phone?: string;
  skills: string[];
  yearsOfExperience: number;
  currentRole?: string;
  targetRole: string;
  experience: Array<{
    company: string;
    role: string;
    period: string;
    achievements: string[];
  }>;
  languages: string[];
  location: string;
}

// ─── Swipe ───────────────────────────────────────────────────

export type SwipeAction = 'like' | 'dislike';

export interface Swipe {
  userId: number;
  jobId: string;
  action: SwipeAction;
  swipedAt: string;
}

// ─── Insight ─────────────────────────────────────────────────

export interface Insight {
  id: number;
  userId: number;
  content: string;
  createdAt: string;
}

// ─── API request/response shapes ─────────────────────────────

export interface GetJobsResponse {
  jobs: JobMatch[];
}

export interface SwipeRequest {
  telegramUserId: number;
  jobId: string;
  action: SwipeAction;
}

export interface OnboardingRequest {
  telegramUserId: number;
  cvUrl?: string;
  preferences?: UserPreferences;
  scheduleHour?: number;
  region?: string;
}
