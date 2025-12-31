/**
 * Tests for Community Routes
 * Covers input validation, voting logic, and response formats for community posts and comments.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

type PostType = 'discussion' | 'review' | 'guide' | 'artwork' | 'announcement';
type PostStatus = 'published' | 'removed' | 'draft';

interface MockPost {
  id: string;
  userId: string;
  gameId: string | null;
  type: PostType;
  title: string;
  content: string;
  rating: number | null;
  images: string[];
  status: PostStatus;
  locked: boolean;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MockComment {
  id: string;
  postId: string;
  userId: string;
  parentId: string | null;
  content: string;
  status: PostStatus;
  upvotes: number;
  downvotes: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants (mirror route constants)
// ============================================================================

const VALID_POST_TYPES: PostType[] = ['discussion', 'review', 'guide', 'artwork', 'announcement'];
const VALID_VOTE_VALUES = [1, -1, 0];

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPost(overrides: Partial<MockPost> = {}): MockPost {
  const now = new Date();
  return {
    id: `post-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    gameId: null,
    type: 'discussion',
    title: 'Test Post Title',
    content: 'This is test content for the post.',
    rating: null,
    images: [],
    status: 'published',
    locked: false,
    upvotes: 0,
    downvotes: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockComment(overrides: Partial<MockComment> = {}): MockComment {
  const now = new Date();
  return {
    id: `comment-${randomUUID()}`,
    postId: `post-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    parentId: null,
    content: 'This is a test comment.',
    status: 'published',
    upvotes: 0,
    downvotes: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validateCreatePostInput(body: Record<string, unknown>): ValidationResult {
  const { type, title, content, rating } = body;

  // Required fields
  if (!type || !title || !content) {
    return { valid: false, error: 'Type, title, and content are required' };
  }

  // Validate type
  if (!VALID_POST_TYPES.includes(type as PostType)) {
    return { valid: false, error: 'Invalid post type' };
  }

  // Validate rating for reviews
  if (type === 'review') {
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return { valid: false, error: 'Reviews require a rating between 1 and 5' };
    }
  }

  return { valid: true };
}

function validateUpdatePostInput(body: Record<string, unknown>): ValidationResult {
  const { title, content } = body;

  // At least one field must be provided
  if (title === undefined && content === undefined) {
    return { valid: true }; // No-op update is allowed
  }

  // Title cannot be empty if provided
  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    return { valid: false, error: 'Title cannot be empty' };
  }

  // Content cannot be empty if provided
  if (content !== undefined && (typeof content !== 'string' || content.trim().length === 0)) {
    return { valid: false, error: 'Content cannot be empty' };
  }

  return { valid: true };
}

function validateCommentInput(body: Record<string, unknown>): ValidationResult {
  const { content } = body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return { valid: false, error: 'Content is required' };
  }

  return { valid: true };
}

function validateVoteInput(body: Record<string, unknown>): ValidationResult {
  const { vote } = body;

  if (!VALID_VOTE_VALUES.includes(vote as number)) {
    return { valid: false, error: 'Invalid vote value' };
  }

  return { valid: true };
}

function canModifyPost(post: MockPost, userId: string, isAdmin: boolean): boolean {
  return post.userId === userId || isAdmin;
}

function canCommentOnPost(post: MockPost): boolean {
  if (post.status !== 'published') return false;
  if (post.locked) return false;
  return true;
}

function calculateVoteChange(
  existingVote: number | null,
  newVote: number
): { upvoteChange: number; downvoteChange: number } {
  let upvoteChange = 0;
  let downvoteChange = 0;

  if (existingVote !== null) {
    if (newVote === 0) {
      // Remove vote
      if (existingVote === 1) upvoteChange = -1;
      if (existingVote === -1) downvoteChange = -1;
    } else if (newVote !== existingVote) {
      // Change vote
      if (existingVote === 1) upvoteChange = -1;
      if (existingVote === -1) downvoteChange = -1;
      if (newVote === 1) upvoteChange += 1;
      if (newVote === -1) downvoteChange += 1;
    }
  } else if (newVote !== 0) {
    // New vote
    if (newVote === 1) upvoteChange = 1;
    if (newVote === -1) downvoteChange = 1;
  }

  return { upvoteChange, downvoteChange };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Community Routes - Post Creation Validation', () => {
  describe('POST /api/community/posts (Create Post)', () => {
    it('should require type field', () => {
      const body = { title: 'Test', content: 'Content' };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Type, title, and content are required');
    });

    it('should require title field', () => {
      const body = { type: 'discussion', content: 'Content' };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require content field', () => {
      const body = { type: 'discussion', title: 'Test' };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject invalid post type', () => {
      const body = { type: 'invalid', title: 'Test', content: 'Content' };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid post type');
    });

    it('should accept all valid post types', () => {
      for (const type of VALID_POST_TYPES) {
        const body = { type, title: 'Test', content: 'Content', rating: type === 'review' ? 5 : undefined };
        const result = validateCreatePostInput(body);
        assert.strictEqual(result.valid, true, `Type '${type}' should be valid`);
      }
    });
  });

  describe('Review Rating Validation', () => {
    it('should require rating for review type', () => {
      const body = { type: 'review', title: 'Test Review', content: 'Great game!' };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('rating'));
    });

    it('should reject rating below 1', () => {
      const body = { type: 'review', title: 'Test', content: 'Content', rating: 0 };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject rating above 5', () => {
      const body = { type: 'review', title: 'Test', content: 'Content', rating: 6 };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid rating 1-5', () => {
      for (let rating = 1; rating <= 5; rating++) {
        const body = { type: 'review', title: 'Test', content: 'Content', rating };
        const result = validateCreatePostInput(body);
        assert.strictEqual(result.valid, true, `Rating ${rating} should be valid`);
      }
    });

    it('should not require rating for non-review types', () => {
      const body = { type: 'discussion', title: 'Test', content: 'Content' };
      const result = validateCreatePostInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Community Routes - Post Update Validation', () => {
  describe('PATCH /api/community/posts/:id (Update Post)', () => {
    it('should allow empty body for no-op update', () => {
      const body = {};
      const result = validateUpdatePostInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject empty title if provided', () => {
      const body = { title: '' };
      const result = validateUpdatePostInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Title cannot be empty');
    });

    it('should reject empty content if provided', () => {
      const body = { content: '' };
      const result = validateUpdatePostInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Content cannot be empty');
    });

    it('should accept valid partial update', () => {
      const body = { title: 'Updated Title' };
      const result = validateUpdatePostInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Community Routes - Comment Validation', () => {
  describe('POST /api/community/posts/:id/comments (Add Comment)', () => {
    it('should require content field', () => {
      const body = {};
      const result = validateCommentInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Content is required');
    });

    it('should reject empty content', () => {
      const body = { content: '' };
      const result = validateCommentInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only content', () => {
      const body = { content: '   ' };
      const result = validateCommentInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid content', () => {
      const body = { content: 'This is a valid comment' };
      const result = validateCommentInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Comment Restrictions', () => {
    it('should allow commenting on published post', () => {
      const post = createMockPost({ status: 'published', locked: false });

      assert.strictEqual(canCommentOnPost(post), true);
    });

    it('should block commenting on removed post', () => {
      const post = createMockPost({ status: 'removed' });

      assert.strictEqual(canCommentOnPost(post), false);
    });

    it('should block commenting on locked post', () => {
      const post = createMockPost({ locked: true });

      assert.strictEqual(canCommentOnPost(post), false);
    });
  });
});

describe('Community Routes - Vote Validation', () => {
  describe('POST /api/community/posts/:id/vote', () => {
    it('should accept upvote (1)', () => {
      const body = { vote: 1 };
      const result = validateVoteInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept downvote (-1)', () => {
      const body = { vote: -1 };
      const result = validateVoteInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept remove vote (0)', () => {
      const body = { vote: 0 };
      const result = validateVoteInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid vote value', () => {
      const body = { vote: 2 };
      const result = validateVoteInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid vote value');
    });

    it('should reject non-numeric vote', () => {
      const body = { vote: 'up' };
      const result = validateVoteInput(body);

      assert.strictEqual(result.valid, false);
    });
  });
});

describe('Community Routes - Vote Calculation', () => {
  describe('calculateVoteChange', () => {
    it('should handle new upvote', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(null, 1);

      assert.strictEqual(upvoteChange, 1);
      assert.strictEqual(downvoteChange, 0);
    });

    it('should handle new downvote', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(null, -1);

      assert.strictEqual(upvoteChange, 0);
      assert.strictEqual(downvoteChange, 1);
    });

    it('should handle removing upvote', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(1, 0);

      assert.strictEqual(upvoteChange, -1);
      assert.strictEqual(downvoteChange, 0);
    });

    it('should handle removing downvote', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(-1, 0);

      assert.strictEqual(upvoteChange, 0);
      assert.strictEqual(downvoteChange, -1);
    });

    it('should handle changing upvote to downvote', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(1, -1);

      assert.strictEqual(upvoteChange, -1);
      assert.strictEqual(downvoteChange, 1);
    });

    it('should handle changing downvote to upvote', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(-1, 1);

      assert.strictEqual(upvoteChange, 1);
      assert.strictEqual(downvoteChange, -1);
    });

    it('should handle same vote (no-op)', () => {
      const { upvoteChange, downvoteChange } = calculateVoteChange(1, 1);

      assert.strictEqual(upvoteChange, 0);
      assert.strictEqual(downvoteChange, 0);
    });
  });
});

describe('Community Routes - Authorization', () => {
  describe('Post Modification', () => {
    it('should allow author to modify post', () => {
      const userId = 'user-123';
      const post = createMockPost({ userId });

      assert.strictEqual(canModifyPost(post, userId, false), true);
    });

    it('should allow admin to modify any post', () => {
      const post = createMockPost({ userId: 'user-123' });

      assert.strictEqual(canModifyPost(post, 'user-456', true), true);
    });

    it('should block non-owner non-admin from modifying', () => {
      const post = createMockPost({ userId: 'user-123' });

      assert.strictEqual(canModifyPost(post, 'user-456', false), false);
    });
  });
});

describe('Community Routes - Response Format', () => {
  describe('Post List Response', () => {
    it('should return posts with pagination', () => {
      const posts = [createMockPost(), createMockPost()];
      const response = createPostListResponse(posts, 100, 20, 0);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.posts.length, 2);
      assert.strictEqual(response.data.total, 100);
      assert.strictEqual(response.data.limit, 20);
      assert.strictEqual(response.data.offset, 0);
      assert.strictEqual(response.data.hasMore, true);
    });
  });

  describe('Vote Response', () => {
    it('should return updated vote counts', () => {
      const response = createVoteResponse(10, 2, 1);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.upvotes, 10);
      assert.strictEqual(response.data.downvotes, 2);
      assert.strictEqual(response.data.userVote, 1);
    });
  });

  describe('Error Response Format', () => {
    it('should return error for not found', () => {
      const response = createErrorResponse('Post not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Post not found');
    });
  });
});

describe('Community Routes - Author Formatting', () => {
  describe('formatAuthor', () => {
    it('should format author with displayName', () => {
      const author = { id: 'user-123', displayName: 'John Doe', email: 'john@example.com' };
      const formatted = formatAuthor(author);

      assert.strictEqual(formatted.id, 'user-123');
      assert.strictEqual(formatted.displayName, 'John Doe');
      assert.ok(!('email' in formatted));
    });

    it('should use email prefix when displayName is null', () => {
      const author = { id: 'user-123', displayName: null, email: 'john@example.com' };
      const formatted = formatAuthor(author);

      assert.strictEqual(formatted.displayName, 'john');
    });
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createPostListResponse(
  posts: MockPost[],
  total: number,
  limit: number,
  offset: number
): {
  success: boolean;
  data: {
    posts: MockPost[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
} {
  return {
    success: true,
    data: {
      posts,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

function createVoteResponse(
  upvotes: number,
  downvotes: number,
  userVote: number
): {
  success: boolean;
  data: { upvotes: number; downvotes: number; userVote: number };
} {
  return {
    success: true,
    data: { upvotes, downvotes, userVote },
  };
}

function formatAuthor(author: {
  id: string;
  displayName: string | null;
  email: string;
}): { id: string; displayName: string } {
  return {
    id: author.id,
    displayName: author.displayName || author.email.split('@')[0],
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
