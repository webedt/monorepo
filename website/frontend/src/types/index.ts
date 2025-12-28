/**
 * Core type definitions for WebEDT client
 */

/**
 * User role - defines access levels for the platform
 * - user: Basic user access (read-only, limited features)
 * - editor: Full access to the editor suite for game creation
 * - developer: Full access plus development tools and API access
 * - admin: Full administrative access including user management
 */
export type UserRole = 'user' | 'editor' | 'developer' | 'admin';

// User types
export interface User {
  id: string;
  email: string;
  displayName?: string;
  githubId?: string;
  githubAccessToken?: string;
  claudeAuth?: ClaudeAuth;
  codexAuth?: CodexAuth;
  geminiAuth?: GeminiAuth;
  preferredProvider?: Provider;
  preferredModel?: string;
  imageResizeMaxDimension?: number;
  voiceCommandKeywords?: string[];
  stopListeningAfterSubmit?: boolean;
  defaultLandingPage?: LandingPage;
  chatVerbosityLevel?: VerbosityLevel;
  imageAiProvider?: ImageAiProvider;
  imageAiModel?: string;
  imageAiKeys?: ImageAiKeys;
  openrouterApiKey?: string;
  autocompleteEnabled?: boolean;
  autocompleteModel?: string;
  isAdmin: boolean;
  role: UserRole;
  createdAt: string;
}

export interface ClaudeAuth {
  sessionKey?: string;
  organizationId?: string;
}

export interface CodexAuth {
  apiKey?: string;
}

export interface GeminiAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface ImageAiKeys {
  openrouter?: string;
  cometapi?: string;
  google?: string;
}

export type Provider = 'claude' | 'codex' | 'copilot' | 'gemini';
export type LandingPage = 'dashboard' | 'store' | 'library' | 'community' | 'sessions';
export type VerbosityLevel = 'minimal' | 'normal' | 'verbose';
export type ImageAiProvider = 'openrouter' | 'cometapi' | 'google';

// Session types
export interface Session {
  id: string;
  userId: string;
  aiWorkerSessionId?: string;
  sessionPath: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryUrl?: string;
  userRequest?: string;
  status: SessionStatus;
  baseBranch?: string;
  branch?: string;
  autoCommit?: boolean;
  locked?: boolean;
  favorite?: boolean;
  createdAt: string;
  completedAt?: string;
  deletedAt?: string;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Message {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  images?: ImageAttachment[];
  createdAt: string;
}

export interface ImageAttachment {
  id: string;
  data: string;
  mediaType: string;
  fileName?: string;
}

// GitHub types
export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description?: string;
  html_url: string;
}

export interface Branch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface TreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface FileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  html_url: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  merged_at?: string;
}

export interface CommitResult {
  success: boolean;
  data: {
    commitSha: string;
    message: string;
    branch: string;
    filesCommitted: number;
    htmlUrl: string;
  };
}

// SSE Event types
export interface SSEEvent {
  type: string;
  timestamp?: string;
  data?: unknown;
}

export interface ExecutionEvent extends SSEEvent {
  type:
    | 'connected'
    | 'message'
    | 'session_name'
    | 'assistant_message'
    | 'tool_use'
    | 'tool_result'
    | 'completed'
    | 'error';
  content?: string;
  stage?: string;
  emoji?: string;
}

// Orchestrator types
export interface OrchestratorJob {
  id: string;
  userId: string;
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  workingBranch: string;
  sessionPath: string;
  requestDocument: string;
  taskList: string | null;
  status: OrchestratorJobStatus;
  currentCycle: number;
  maxCycles: number | null;
  timeLimitMinutes: number | null;
  maxParallelTasks: number;
  provider: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export type OrchestratorJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

export interface OrchestratorCycle {
  id: string;
  jobId: string;
  cycleNumber: number;
  phase: string;
  tasksDiscovered: number;
  tasksLaunched: number;
  tasksCompleted: number;
  tasksFailed: number;
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface OrchestratorTask {
  id: string;
  cycleId: string;
  jobId: string;
  taskNumber: number;
  description: string;
  context: string | null;
  priority: string;
  canRunParallel: boolean;
  status: string;
  agentSessionId: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Admin types
export interface AdminStats {
  userCount: number;
  sessionCount: number;
  activeSessionCount: number;
  roleCounts?: {
    user: number;
    editor: number;
    developer: number;
    admin: number;
  };
}

// Game Store types
export interface Game {
  id: string;
  title: string;
  description?: string;
  shortDescription?: string;
  price: number;
  currency: string;
  coverImage?: string;
  screenshots?: string[];
  trailerUrl?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres?: string[];
  tags?: string[];
  platforms?: string[];
  rating?: string;
  averageScore?: number;
  reviewCount: number;
  downloadCount: number;
  featured: boolean;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface LibraryItem {
  id: string;
  userId: string;
  gameId: string;
  purchaseId?: string;
  acquiredAt: string;
  lastPlayedAt?: string;
  playtimeMinutes: number;
  favorite: boolean;
  hidden: boolean;
  installStatus: 'not_installed' | 'installing' | 'installed';
  game?: Game;
}

export interface Purchase {
  id: string;
  userId: string;
  gameId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'refunded' | 'failed';
  paymentMethod?: string;
  createdAt: string;
  completedAt?: string;
  game?: Game;
}

export interface WishlistItem {
  id: string;
  userId: string;
  gameId: string;
  priority: number;
  notifyOnSale: boolean;
  addedAt: string;
  game?: Game;
}

export interface StoreHighlights {
  featured: Game[];
  new: Game[];
  hasHighlights: boolean;
}

export interface CommunityPost {
  id: string;
  userId: string;
  gameId?: string;
  type: 'discussion' | 'review' | 'guide' | 'artwork' | 'announcement';
  title: string;
  content: string;
  images?: string[];
  rating?: number;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  pinned: boolean;
  locked: boolean;
  status: 'draft' | 'published' | 'removed';
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    displayName?: string;
  };
  game?: Game;
}

export interface CommunityComment {
  id: string;
  postId: string;
  userId: string;
  parentId?: string;
  content: string;
  upvotes: number;
  downvotes: number;
  status: 'published' | 'removed';
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    displayName?: string;
  };
}

// Community Channels types
export interface CommunityChannel {
  id: string;
  name: string;
  slug: string;
  description?: string;
  gameId?: string;
  isDefault: boolean;
  isReadOnly: boolean;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  game?: Game;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  replyToId?: string;
  images?: string[];
  edited: boolean;
  status: 'published' | 'removed';
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    displayName?: string;
  };
  channel?: {
    id: string;
    name: string;
    slug: string;
  };
}

// Collections types
export interface Collection {
  id: string;
  userId: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  sessionCount?: number;
}

export interface SessionCollection {
  id: string;
  sessionId: string;
  collectionId: string;
  addedAt: string;
}

// Taxonomy types
export interface Taxonomy {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  slug: string;
  allowMultiple: boolean;
  isRequired: boolean;
  itemTypes: string[];
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  terms?: TaxonomyTerm[];
}

export interface TaxonomyTerm {
  id: string;
  taxonomyId: string;
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
  color?: string;
  icon?: string;
  metadata?: Record<string, unknown>;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ItemTaxonomy {
  id: string;
  termId: string;
  itemType: string;
  itemId: string;
  createdAt: string;
}

export interface TaxonomyWithTerms extends Taxonomy {
  terms: TaxonomyTerm[];
}

// Announcements types
export type AnnouncementType = 'maintenance' | 'feature' | 'alert' | 'general';
export type AnnouncementPriority = 'low' | 'normal' | 'high' | 'critical';
export type AnnouncementStatus = 'draft' | 'published' | 'archived';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  priority: AnnouncementPriority;
  status: AnnouncementStatus;
  authorId: string | null; // Nullable - set to null if author is deleted
  publishedAt?: string;
  expiresAt?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    displayName?: string;
  };
}

// Cloud Saves types
export interface CloudSave {
  id: string;
  userId: string;
  gameId: string;
  slotNumber: number;
  slotName?: string;
  saveData?: string;
  hasData?: boolean;
  fileSize: number;
  checksum?: string;
  platformData?: CloudSavePlatformData;
  screenshotUrl?: string;
  playTimeSeconds: number;
  gameProgress?: CloudSaveGameProgress;
  lastPlayedAt?: string;
  createdAt: string;
  updatedAt: string;
  game?: {
    id: string;
    title: string;
    coverImage?: string;
  };
}

export interface CloudSavePlatformData {
  deviceName?: string;
  platform?: string;
  gameVersion?: string;
  browserInfo?: string;
}

export interface CloudSaveGameProgress {
  level?: number;
  chapter?: string;
  percentage?: number;
  customData?: Record<string, unknown>;
}

export interface CloudSaveVersion {
  id: string;
  cloudSaveId: string;
  version: number;
  saveData?: string;
  hasData?: boolean;
  fileSize: number;
  checksum?: string;
  platformData?: CloudSavePlatformData;
  createdAt: string;
}

export interface CloudSaveSyncLog {
  id: string;
  userId: string;
  cloudSaveId?: string;
  operation: 'upload' | 'download' | 'delete' | 'conflict_resolved';
  deviceInfo?: {
    deviceName?: string;
    platform?: string;
    browserInfo?: string;
    ipAddress?: string;
  };
  status: 'success' | 'failed' | 'conflict';
  errorMessage?: string;
  bytesTransferred?: number;
  createdAt: string;
}

export interface CloudSaveStats {
  totalSaves: number;
  totalSizeBytes: string;
  gamesWithSaves: number;
  lastSyncAt?: string;
}

export interface LocalSaveInfo {
  gameId: string;
  slotNumber: number;
  checksum: string;
  updatedAt: Date | string;
}

export interface CloudSaveSyncConflict {
  localInfo: LocalSaveInfo;
  remoteSave: CloudSave;
  conflictType: 'newer_remote' | 'newer_local' | 'both_modified';
}

// Bone Animation types

/**
 * 2D Vector for positions and scales
 */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Transform data for a bone at a specific keyframe
 */
export interface BoneTransform {
  position: Vector2;
  rotation: number; // degrees
  scale: Vector2;
}

/**
 * Bone definition in a skeleton hierarchy
 */
export interface Bone {
  name: string;
  parent: string | null;
  length: number;
  localTransform: BoneTransform;
}

/**
 * Keyframe containing transforms for all bones at a specific time
 */
export interface BoneKeyframe {
  time: number; // seconds
  transforms: Record<string, BoneTransform>;
}

/**
 * Complete bone animation data
 */
export interface BoneAnimation {
  name: string;
  type: 'bone';
  fps: number;
  duration: number; // seconds
  bones: Bone[];
  keyframes: BoneKeyframe[];
  loop: boolean;
}

/**
 * A single frame in a frame-based animation
 */
export interface AnimationFrame {
  /** Frame duration in seconds (or use animation's default if not specified) */
  duration?: number;
  /** Image source - can be a URL, data URL, or canvas reference ID */
  source: string;
  /** Optional offset for the frame */
  offset?: Vector2;
  /** Optional pivot point for rotation/scaling */
  pivot?: Vector2;
}

/**
 * Complete frame-based animation data (sprite sheet / flipbook style)
 */
export interface FrameAnimation {
  name: string;
  type: 'frame';
  fps: number;
  frames: AnimationFrame[];
  loop: boolean;
  /** Optional ping-pong mode: play forward then backward */
  pingPong?: boolean;
}

/**
 * Union type for all animation types
 */
export type Animation = BoneAnimation | FrameAnimation;

/**
 * Animation clip reference for use in Animator
 */
export interface AnimationClip {
  name: string;
  animation: Animation;
  /** Speed multiplier for this clip */
  speed?: number;
  /** Override loop setting for this clip */
  loop?: boolean;
}

/**
 * Skeleton instance with current pose
 */
export interface Skeleton {
  bones: Bone[];
  pose: Record<string, BoneTransform>;
}

/**
 * Easing function types for interpolation
 */
export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/**
 * Animation playback state
 */
export interface AnimationPlaybackState {
  isPlaying: boolean;
  currentTime: number;
  speed: number;
  loop: boolean;
}

// Snippet types
export const SNIPPET_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'c',
  'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'html',
  'css', 'scss', 'sql', 'bash', 'powershell', 'yaml', 'json', 'xml',
  'markdown', 'dockerfile', 'terraform', 'graphql', 'other'
] as const;

export type SnippetLanguage = typeof SNIPPET_LANGUAGES[number];

export const SNIPPET_CATEGORIES = [
  'function', 'class', 'component', 'hook', 'utility', 'api',
  'database', 'testing', 'config', 'boilerplate', 'algorithm',
  'pattern', 'snippet', 'template', 'other'
] as const;

export type SnippetCategory = typeof SNIPPET_CATEGORIES[number];

export interface SnippetVariable {
  description?: string;
  defaultValue?: string;
  placeholder?: string;
}

export interface Snippet {
  id: string;
  userId: string;
  title: string;
  description?: string;
  code: string;
  language: SnippetLanguage;
  category: SnippetCategory;
  tags: string[];
  variables?: Record<string, SnippetVariable>;
  usageCount: number;
  isFavorite: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  collections?: SnippetCollectionSummary[];
}

export interface SnippetCollectionSummary {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface SnippetCollection {
  id: string;
  userId: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  snippetCount?: number;
}

export interface CreateSnippetRequest {
  title: string;
  description?: string;
  code: string;
  language?: SnippetLanguage;
  category?: SnippetCategory;
  tags?: string[];
  variables?: Record<string, SnippetVariable>;
  isFavorite?: boolean;
  isPublic?: boolean;
  collectionIds?: string[];
}

export interface UpdateSnippetRequest {
  title?: string;
  description?: string;
  code?: string;
  language?: SnippetLanguage;
  category?: SnippetCategory;
  tags?: string[];
  variables?: Record<string, SnippetVariable>;
  isFavorite?: boolean;
  isPublic?: boolean;
}

export interface SnippetListFilters {
  language?: SnippetLanguage;
  category?: SnippetCategory;
  search?: string;
  favorite?: boolean;
  collectionId?: string;
  sortBy?: 'title' | 'usageCount' | 'lastUsedAt' | 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
}

// Audio Source types

/**
 * Oscillator waveform types for audio generation
 */
export type WaveformType = 'sine' | 'square' | 'sawtooth' | 'triangle';

/**
 * ADSR Envelope configuration for audio sources
 */
export interface EnvelopeConfig {
  /** Attack time in seconds */
  attack: number;
  /** Decay time in seconds */
  decay: number;
  /** Sustain level (0-1) */
  sustain: number;
  /** Release time in seconds */
  release: number;
}

/**
 * Audio source configuration
 */
export interface AudioSourceConfig {
  /** Oscillator waveform type */
  waveform: WaveformType;
  /** Base frequency in Hz */
  frequency: number;
  /** Volume level (0-1) */
  volume: number;
  /** Detune in cents */
  detune: number;
  /** ADSR envelope */
  envelope: EnvelopeConfig;
}

/**
 * Audio source playback state
 */
export interface AudioSourceState {
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Current frequency being played */
  currentFrequency: number;
  /** Current volume level */
  currentVolume: number;
}
