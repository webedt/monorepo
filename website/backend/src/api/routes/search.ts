/**
 * Universal Search Routes
 * Searches across all fields (title, description, tags, creator, etc.)
 */

import { Router, Request, Response } from 'express';
import { db, games, users, chatSessions, communityPosts, eq, and, or, desc, sql, ilike } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { logger } from '@webedt/shared';

const router = Router();

interface SearchResultItem {
  id: string;
  type: 'game' | 'user' | 'session' | 'post';
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags?: string[];
  matchedFields?: string[];
}

interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  query: string;
}

/**
 * Search games using database-level ILIKE filtering
 */
async function searchGames(searchTerm: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const searchPattern = `%${searchTerm}%`;

  // Use database-level filtering with ILIKE for better performance
  const matchedGames = await db
    .select()
    .from(games)
    .where(
      and(
        eq(games.status, 'published'),
        or(
          ilike(games.title, searchPattern),
          ilike(games.description, searchPattern),
          ilike(games.developer, searchPattern),
          ilike(games.publisher, searchPattern)
        )
      )
    )
    .limit(50);

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

    if (matchedFields.length > 0) {
      results.push({
        id: game.id,
        type: 'game',
        title: game.title,
        subtitle: game.developer ?? game.publisher ?? undefined,
        description: game.shortDescription ?? game.description?.substring(0, 100),
        image: game.coverImage ?? undefined,
        tags: game.tags?.slice(0, 5),
        matchedFields,
      });
    }
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
    .limit(20);

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
 * Search sessions for authenticated user using database-level ILIKE filtering
 */
async function searchSessions(searchTerm: string, userId: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const searchPattern = `%${searchTerm}%`;

  const matchedSessions = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        sql`${chatSessions.deletedAt} IS NULL`,
        or(
          ilike(chatSessions.userRequest, searchPattern),
          ilike(chatSessions.repositoryName, searchPattern),
          ilike(chatSessions.branch, searchPattern)
        )
      )
    )
    .orderBy(desc(chatSessions.createdAt))
    .limit(30);

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

    if (matchedFields.length > 0) {
      results.push({
        id: session.id,
        type: 'session',
        title: session.userRequest?.substring(0, 50) || 'Untitled Session',
        subtitle: session.repositoryName ? `${session.repositoryOwner}/${session.repositoryName}` : undefined,
        description: session.userRequest?.substring(0, 100),
        matchedFields,
      });
    }
  }

  return results;
}

/**
 * Search community posts using database-level ILIKE filtering
 */
async function searchPosts(searchTerm: string): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const searchPattern = `%${searchTerm}%`;

  const matchedPosts = await db
    .select()
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.status, 'published'),
        or(
          ilike(communityPosts.title, searchPattern),
          ilike(communityPosts.content, searchPattern)
        )
      )
    )
    .orderBy(desc(communityPosts.createdAt))
    .limit(30);

  const lowerSearchTerm = searchTerm.toLowerCase();

  for (const post of matchedPosts) {
    const matchedFields: string[] = [];

    if (post.title.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('title');
    }
    if (post.content.toLowerCase().includes(lowerSearchTerm)) {
      matchedFields.push('content');
    }

    if (matchedFields.length > 0) {
      results.push({
        id: post.id,
        type: 'post',
        title: post.title,
        subtitle: post.type.charAt(0).toUpperCase() + post.type.slice(1),
        description: post.content.substring(0, 100),
        matchedFields,
      });
    }
  }

  return results;
}

/**
 * Universal search endpoint
 * Searches across games, users, sessions, and community posts
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const query = (req.query.q as string || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
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

    // Sort by relevance (more matched fields = higher relevance)
    results.sort((a, b) => {
      // First, sort by number of matched fields
      const fieldDiff = (b.matchedFields?.length || 0) - (a.matchedFields?.length || 0);
      if (fieldDiff !== 0) return fieldDiff;

      // Then, prioritize title matches
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
 * Get search suggestions based on game titles
 */
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

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
