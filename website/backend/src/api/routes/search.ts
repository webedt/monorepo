/**
 * Universal Search Routes
 * Searches across all fields (title, description, tags, creator, etc.)
 *
 * Uses PostgreSQL tsvector full-text search for indexed, ranked search results.
 * Falls back to ILIKE for tables without search_vector columns.
 */

import { Router, Request, Response } from 'express';
import {
  db,
  games,
  users,
  chatSessions,
  communityPosts,
  eq,
  and,
  or,
  desc,
  sql,
  ilike,
  LIMITS,
  buildSearchCondition,
  buildRankSelect,
  buildHeadlineSelect,
  sanitizeSearchQuery,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { searchRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Search
 *     description: Universal search across all content types
 */

interface SearchResultItem {
  id: string;
  type: 'game' | 'user' | 'session' | 'post';
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags?: string[];
  matchedFields?: string[];
  /** Relevance rank from full-text search (0-1, higher is better) */
  rank?: number;
  /** Highlighted excerpt with matching terms */
  highlight?: string;
}

interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  query: string;
}

/**
 * Search games using PostgreSQL full-text search with tsvector
 * Uses indexed search for 10-100x faster queries with relevance ranking
 */
async function searchGames(searchTerm: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const sanitized = sanitizeSearchQuery(searchTerm);

  if (!sanitized) {
    return results;
  }

  // Use full-text search with tsvector for indexed, ranked results
  const matchedGames = await db
    .select({
      id: games.id,
      title: games.title,
      description: games.description,
      shortDescription: games.shortDescription,
      developer: games.developer,
      publisher: games.publisher,
      coverImage: games.coverImage,
      tags: games.tags,
      genres: games.genres,
      // Get relevance rank from tsvector search
      rank: buildRankSelect(games.searchVector, searchTerm),
      // Get highlighted excerpt from description
      highlight: buildHeadlineSelect(games.description, searchTerm, {
        startSel: '<mark>',
        stopSel: '</mark>',
        maxWords: 25,
        minWords: 10,
      }),
    })
    .from(games)
    .where(
      and(
        eq(games.status, 'published'),
        buildSearchCondition(games.searchVector, searchTerm)
      )
    )
    .orderBy(sql`${buildRankSelect(games.searchVector, searchTerm)} DESC`)
    .limit(LIMITS.SEARCH.GAMES);

  for (const game of matchedGames) {
    const matchedFields: string[] = [];
    const lowerSearchTerm = searchTerm.toLowerCase();

    // Determine which fields matched (for display purposes)
    if (game.title.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('title');
    }
    if (game.description?.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('description');
    }
    if (game.developer?.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('developer');
    }
    if (game.publisher?.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('publisher');
    }
    if (game.tags?.some(tag => tag.toLowerCase().includes(lowerSearchTerm))) {
      matchedFields.push('tags');
    }
    if (game.genres?.some(genre => genre.toLowerCase().includes(lowerSearchTerm))) {
      matchedFields.push('genres');
    }

    results.push({
      id: game.id,
      type: 'game',
      title: game.title,
      subtitle: game.developer ?? game.publisher ?? undefined,
      description: game.highlight || game.shortDescription || game.description?.substring(0, 100),
      image: game.coverImage ?? undefined,
      tags: game.tags?.slice(0, 5),
      matchedFields: matchedFields.length > 0 ? matchedFields : ['relevance'],
      rank: game.rank,
      highlight: game.highlight,
    });
  }

  return results;
}

/**
 * Search users using database-level ILIKE filtering
 * Note: Only searches by displayName to protect privacy
 */
async function searchUsers(searchTerm: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const searchPattern = `%${searchTerm}%`;

  // Only search by displayName to protect email privacy
  const matchedUsers = await db
    .select({
      id: users.id,
      displayName: users.displayName,
    })
    .from(users)
    .where(ilike(users.displayName, searchPattern))
    .limit(LIMITS.SEARCH.USERS);

  for (const user of matchedUsers) {
    if (user.displayName) {
      results.push({
        id: user.id,
        type: 'user',
        title: user.displayName,
        matchedFields: ['displayName'],
      });
    }
  }

  return results;
}

/**
 * Search sessions for authenticated user using PostgreSQL full-text search
 * Uses indexed tsvector search for fast, ranked results
 */
async function searchSessions(searchTerm: string, userId: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const sanitized = sanitizeSearchQuery(searchTerm);

  if (!sanitized) {
    return results;
  }

  const matchedSessions = await db
    .select({
      id: chatSessions.id,
      userRequest: chatSessions.userRequest,
      repositoryOwner: chatSessions.repositoryOwner,
      repositoryName: chatSessions.repositoryName,
      branch: chatSessions.branch,
      rank: buildRankSelect(chatSessions.searchVector, searchTerm),
      highlight: buildHeadlineSelect(chatSessions.userRequest, searchTerm, {
        startSel: '<mark>',
        stopSel: '</mark>',
        maxWords: 20,
        minWords: 8,
      }),
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        sql`${chatSessions.deletedAt} IS NULL`,
        buildSearchCondition(chatSessions.searchVector, searchTerm)
      )
    )
    .orderBy(sql`${buildRankSelect(chatSessions.searchVector, searchTerm)} DESC`)
    .limit(LIMITS.SEARCH.SESSIONS);

  const lowerSearchTerm = searchTerm.toLowerCase();

  for (const session of matchedSessions) {
    const matchedFields: string[] = [];

    if (session.userRequest?.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('request');
    }
    if (session.repositoryName?.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('repository');
    }
    if (session.branch?.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('branch');
    }

    results.push({
      id: session.id,
      type: 'session',
      title: session.userRequest?.substring(0, 50) || 'Untitled Session',
      subtitle: session.repositoryName ? `${session.repositoryOwner}/${session.repositoryName}` : undefined,
      description: session.highlight || session.userRequest?.substring(0, 100),
      matchedFields: matchedFields.length > 0 ? matchedFields : ['relevance'],
      rank: session.rank,
      highlight: session.highlight,
    });
  }

  return results;
}

/**
 * Search community posts using PostgreSQL full-text search
 * Uses indexed tsvector search for fast, ranked results
 */
async function searchPosts(searchTerm: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const sanitized = sanitizeSearchQuery(searchTerm);

  if (!sanitized) {
    return results;
  }

  const matchedPosts = await db
    .select({
      id: communityPosts.id,
      title: communityPosts.title,
      content: communityPosts.content,
      type: communityPosts.type,
      rank: buildRankSelect(communityPosts.searchVector, searchTerm),
      highlight: buildHeadlineSelect(communityPosts.content, searchTerm, {
        startSel: '<mark>',
        stopSel: '</mark>',
        maxWords: 25,
        minWords: 10,
      }),
    })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.status, 'published'),
        buildSearchCondition(communityPosts.searchVector, searchTerm)
      )
    )
    .orderBy(sql`${buildRankSelect(communityPosts.searchVector, searchTerm)} DESC`)
    .limit(LIMITS.SEARCH.POSTS);

  const lowerSearchTerm = searchTerm.toLowerCase();

  for (const post of matchedPosts) {
    const matchedFields: string[] = [];

    if (post.title.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('title');
    }
    if (post.content.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('content');
    }

    results.push({
      id: post.id,
      type: 'post',
      title: post.title,
      subtitle: post.type.charAt(0).toUpperCase() + post.type.slice(1),
      description: post.highlight || post.content.substring(0, 100),
      matchedFields: matchedFields.length > 0 ? matchedFields : ['relevance'],
      rank: post.rank,
      highlight: post.highlight,
    });
  }

  return results;
}

/**
 * @openapi
 * /search:
 *   get:
 *     tags:
 *       - Search
 *     summary: Universal search
 *     description: Searches across games, users, sessions, and posts. Rate limited to 30/min.
 *     security: []
 *     parameters:
 *       - name: q
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *       - name: types
 *         in: query
 *         schema:
 *           type: string
 *           description: Comma-separated (game,user,session,post)
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total:
 *                       type: integer
 *                     query:
 *                       type: string
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', searchRateLimiter, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const query = (req.query.q as string || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || LIMITS.SEARCH.DEFAULT, LIMITS.SEARCH.MAX);
    const types = (req.query.types as string)?.split(',') || ['game', 'user', 'session', 'post'];

    if (!query || query.length < 2) {
      res.json({
        success: true,
        data: {
          items: [],
          total: 0,
          query,
        } as SearchResponse,
      });
      return;
    }

    // Build array of search promises based on requested types
    const searchPromises: Promise<SearchResultItem[]>[] = [];
    const searchTypes: string[] = [];

    if (types.includes('game')) {
      searchPromises.push(searchGames(query));
      searchTypes.push('game');
    }

    if (types.includes('user')) {
      searchPromises.push(searchUsers(query));
      searchTypes.push('user');
    }

    if (types.includes('session') && authReq.user) {
      searchPromises.push(searchSessions(query, authReq.user.id));
      searchTypes.push('session');
    }

    if (types.includes('post')) {
      searchPromises.push(searchPosts(query));
      searchTypes.push('post');
    }

    // Execute all searches in parallel
    const searchResults = await Promise.all(searchPromises);

    // Combine all results
    const results: SearchResultItem[] = searchResults.flat();

    // Sort by relevance using full-text search rank (higher is better)
    results.sort((a, b) => {
      // Primary: Sort by tsvector rank (if available from full-text search)
      const rankDiff = (b.rank ?? 0) - (a.rank ?? 0);
      if (Math.abs(rankDiff) > 0.01) return rankDiff;

      // Secondary: Sort by number of matched fields
      const fieldDiff = (b.matchedFields?.length || 0) - (a.matchedFields?.length || 0);
      if (fieldDiff !== 0) return fieldDiff;

      // Tertiary: Prioritize title matches
      const aHasTitle = a.matchedFields?.includes('title') ? 1 : 0;
      const bHasTitle = b.matchedFields?.includes('title') ? 1 : 0;
      return bHasTitle - aHasTitle;
    });

    // Limit results
    const limitedResults = results.slice(0, limit);

    res.json({
      success: true,
      data: {
        items: limitedResults,
        total: results.length,
        query,
      } as SearchResponse,
    });
  } catch (error) {
    logger.error('Universal search error', error as Error, { component: 'Search' });
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

/**
 * @openapi
 * /search/suggestions:
 *   get:
 *     tags:
 *       - Search
 *     summary: Get search suggestions
 *     security: []
 *     parameters:
 *       - name: q
 *         in: query
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 5
 *           maximum: 10
 *     responses:
 *       200:
 *         description: Suggestions retrieved
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/suggestions', searchRateLimiter, async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || LIMITS.SEARCH.SUGGESTIONS_DEFAULT, LIMITS.SEARCH.SUGGESTIONS_MAX);

    if (!query || query.length < 1) {
      res.json({
        success: true,
        data: {
          suggestions: [],
        },
      });
      return;
    }

    // Use database-level ILIKE for prefix matching
    const searchPattern = `${query}%`;

    const matchedGames = await db
      .select({ title: games.title })
      .from(games)
      .where(
        and(
          eq(games.status, 'published'),
          ilike(games.title, searchPattern)
        )
      )
      .limit(limit);

    const suggestions = matchedGames.map(g => g.title);

    res.json({
      success: true,
      data: {
        suggestions,
      },
    });
  } catch (error) {
    logger.error('Search suggestions error', error as Error, { component: 'Search' });
    res.status(500).json({ success: false, error: 'Failed to get suggestions' });
  }
});

export default router;
