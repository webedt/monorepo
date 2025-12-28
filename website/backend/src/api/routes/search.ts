/**
 * Universal Search Routes
 * Searches across all fields (title, description, tags, creator, etc.)
 */

import { Router, Request, Response } from 'express';
import { db, games, users, chatSessions, communityPosts, eq, and, desc, sql } from '@webedt/shared';
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

    const searchTerm = query.toLowerCase();
    const results: SearchResultItem[] = [];

    // Search games
    if (types.includes('game')) {
      const allGames = await db
        .select()
        .from(games)
        .where(eq(games.status, 'published'));

      for (const game of allGames) {
        const matchedFields: string[] = [];

        if (game.title.toLowerCase().includes(searchTerm)) {
          matchedFields.push('title');
        }
        if (game.description?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('description');
        }
        if (game.developer?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('developer');
        }
        if (game.publisher?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('publisher');
        }
        if (game.tags?.some(tag => tag.toLowerCase().includes(searchTerm))) {
          matchedFields.push('tags');
        }
        if (game.genres?.some(genre => genre.toLowerCase().includes(searchTerm))) {
          matchedFields.push('genres');
        }

        if (matchedFields.length > 0) {
          results.push({
            id: game.id,
            type: 'game',
            title: game.title,
            subtitle: game.developer || game.publisher,
            description: game.shortDescription || game.description?.substring(0, 100),
            image: game.coverImage,
            tags: game.tags?.slice(0, 5),
            matchedFields,
          });
        }
      }
    }

    // Search users (public profiles only)
    if (types.includes('user')) {
      const allUsers = await db
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        })
        .from(users);

      for (const user of allUsers) {
        const matchedFields: string[] = [];

        if (user.displayName?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('displayName');
        }
        // Only match email for the current user's own account
        if (authReq.user?.id === user.id && user.email.toLowerCase().includes(searchTerm)) {
          matchedFields.push('email');
        }

        if (matchedFields.length > 0) {
          results.push({
            id: user.id,
            type: 'user',
            title: user.displayName || 'User',
            subtitle: user.displayName ? undefined : user.email.split('@')[0],
            matchedFields,
          });
        }
      }
    }

    // Search sessions (user's own sessions only if authenticated)
    if (types.includes('session') && authReq.user) {
      const userSessions = await db
        .select()
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.userId, authReq.user.id),
            sql`${chatSessions.deletedAt} IS NULL`
          )
        )
        .orderBy(desc(chatSessions.createdAt))
        .limit(50);

      for (const session of userSessions) {
        const matchedFields: string[] = [];

        if (session.title?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('title');
        }
        if (session.userRequest?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('request');
        }
        if (session.repositoryName?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('repository');
        }
        if (session.branch?.toLowerCase().includes(searchTerm)) {
          matchedFields.push('branch');
        }

        if (matchedFields.length > 0) {
          results.push({
            id: session.id,
            type: 'session',
            title: session.title || session.userRequest?.substring(0, 50) || 'Untitled Session',
            subtitle: session.repositoryName ? `${session.repositoryOwner}/${session.repositoryName}` : undefined,
            description: session.userRequest?.substring(0, 100),
            matchedFields,
          });
        }
      }
    }

    // Search community posts
    if (types.includes('post')) {
      const allPosts = await db
        .select()
        .from(communityPosts)
        .where(eq(communityPosts.status, 'published'))
        .orderBy(desc(communityPosts.createdAt))
        .limit(100);

      for (const post of allPosts) {
        const matchedFields: string[] = [];

        if (post.title.toLowerCase().includes(searchTerm)) {
          matchedFields.push('title');
        }
        if (post.content.toLowerCase().includes(searchTerm)) {
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
    }

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
 * Get search suggestions based on popular/recent searches
 */
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || '').trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

    if (!query) {
      res.json({
        success: true,
        data: {
          suggestions: [],
        },
      });
      return;
    }

    // Get game titles that match the query prefix
    const allGames = await db
      .select({ title: games.title })
      .from(games)
      .where(eq(games.status, 'published'));

    const suggestions = allGames
      .filter(g => g.title.toLowerCase().startsWith(query))
      .map(g => g.title)
      .slice(0, limit);

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
