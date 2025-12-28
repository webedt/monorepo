/**
 * Community Page
 * View and participate in community discussions, reviews, and guides
 */

import { Page } from '../base/Page';
import { communityApi } from '../../lib/api';
import { authStore } from '../../stores/authStore';
import type { CommunityPost, CommunityComment } from '../../types';
import './community.css';

export class CommunityPage extends Page {
  readonly route = '/community';
  readonly title = 'Community';
  protected requiresAuth = false;

  private posts: CommunityPost[] = [];
  private singlePost: CommunityPost | null = null;
  private postComments: CommunityComment[] = [];
  private loading = true;
  private activeTab: 'discussion' | 'review' | 'guide' | 'artwork' | 'all' = 'all';
  private total = 0;
  private offset = 0;
  private limit = 20;

  protected render(): string {
    if (this.loading) {
      return `
        <div class="community-page">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading community...</p>
          </div>
        </div>
      `;
    }

    // Single post view
    if (this.singlePost) {
      return this.renderSinglePost();
    }

    return `
      <div class="community-page">
        <header class="community-header">
          <div class="header-content">
            <h1>Community</h1>
            <p>Join the conversation</p>
          </div>
          ${authStore.isAuthenticated() ? `
            <button id="create-post-btn" class="btn btn-primary">Create Post</button>
          ` : `
            <a href="#/login" class="btn btn-secondary">Login to Post</a>
          `}
        </header>

        <div class="community-tabs">
          <button class="tab ${this.activeTab === 'all' ? 'active' : ''}" data-tab="all">All</button>
          <button class="tab ${this.activeTab === 'discussion' ? 'active' : ''}" data-tab="discussion">Discussions</button>
          <button class="tab ${this.activeTab === 'review' ? 'active' : ''}" data-tab="review">Reviews</button>
          <button class="tab ${this.activeTab === 'guide' ? 'active' : ''}" data-tab="guide">Guides</button>
          <button class="tab ${this.activeTab === 'artwork' ? 'active' : ''}" data-tab="artwork">Artwork</button>
        </div>

        <div class="community-content">
          ${this.posts.length === 0 ? `
            <div class="empty-state">
              <h2>No posts yet</h2>
              <p>Be the first to start a discussion!</p>
            </div>
          ` : `
            <div class="posts-list">
              ${this.posts.map((post) => this.renderPost(post)).join('')}
            </div>
          `}

          ${this.total > this.offset + this.limit ? `
            <div class="load-more">
              <button id="load-more-btn" class="btn btn-secondary">
                Load More
              </button>
            </div>
          ` : ''}
        </div>

        <div id="create-post-modal" class="modal hidden">
          <div class="modal-content">
            <div class="modal-header">
              <h2>Create Post</h2>
              <button class="close-btn" id="close-modal">&times;</button>
            </div>
            <form id="create-post-form">
              <div class="form-group">
                <label for="post-type">Type</label>
                <select id="post-type" required>
                  <option value="discussion">Discussion</option>
                  <option value="review">Review</option>
                  <option value="guide">Guide</option>
                  <option value="artwork">Artwork</option>
                </select>
              </div>
              <div class="form-group">
                <label for="post-title">Title</label>
                <input type="text" id="post-title" required placeholder="Enter a title..." />
              </div>
              <div class="form-group" id="rating-group" style="display: none;">
                <label for="post-rating">Rating</label>
                <select id="post-rating">
                  <option value="5">★★★★★</option>
                  <option value="4">★★★★☆</option>
                  <option value="3">★★★☆☆</option>
                  <option value="2">★★☆☆☆</option>
                  <option value="1">★☆☆☆☆</option>
                </select>
              </div>
              <div class="form-group">
                <label for="post-content">Content</label>
                <textarea id="post-content" required placeholder="Write your post..." rows="6"></textarea>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-post">Cancel</button>
                <button type="submit" class="btn btn-primary">Post</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  private renderPost(post: CommunityPost): string {
    const typeLabels: Record<string, string> = {
      discussion: 'Discussion',
      review: 'Review',
      guide: 'Guide',
      artwork: 'Artwork',
      announcement: 'Announcement',
    };

    return `
      <article class="post-card" data-post-id="${post.id}">
        <div class="post-header">
          <span class="post-type post-type--${post.type}">${typeLabels[post.type] || post.type}</span>
          ${post.pinned ? '<span class="post-pinned">📌 Pinned</span>' : ''}
          ${post.game ? `<a href="#/game/${post.game.id}" class="post-game">${this.escapeHtml(post.game.title)}</a>` : ''}
        </div>
        <h3 class="post-title">
          <a href="#/community/post/${post.id}">${this.escapeHtml(post.title)}</a>
        </h3>
        <div class="post-meta">
          <span class="post-author">${post.author?.displayName || 'Anonymous'}</span>
          <span class="post-date">${this.formatDate(post.createdAt)}</span>
          ${post.type === 'review' && post.rating ? `
            <span class="post-rating">${'★'.repeat(post.rating)}${'☆'.repeat(5 - post.rating)}</span>
          ` : ''}
        </div>
        <p class="post-excerpt">
          ${this.escapeHtml(post.content.substring(0, 200))}${post.content.length > 200 ? '...' : ''}
        </p>
        <div class="post-footer">
          <div class="post-stats">
            <span class="votes">
              <button class="vote-btn" data-vote="1" data-post-id="${post.id}">👍</button>
              <span class="vote-count">${post.upvotes - post.downvotes}</span>
              <button class="vote-btn" data-vote="-1" data-post-id="${post.id}">👎</button>
            </span>
            <span class="comments">💬 ${post.commentCount}</span>
          </div>
        </div>
      </article>
    `;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.singlePost = null;
    this.postComments = [];
    this.element.innerHTML = this.render();

    // Check if viewing a single post
    const postId = this.getParams().postId;
    if (postId) {
      await this.loadSinglePost(postId);
      return;
    }

    // Check for query params
    const type = this.getQuery().get('type');
    if (type && ['discussion', 'review', 'guide', 'artwork'].includes(type)) {
      this.activeTab = type as typeof this.activeTab;
    }

    await this.loadPosts();
  }

  private async loadPosts(append = false): Promise<void> {
    try {
      const result = await communityApi.getPosts({
        type: this.activeTab !== 'all' ? this.activeTab : undefined,
        limit: this.limit,
        offset: this.offset,
      });

      if (append) {
        this.posts = [...this.posts, ...(result.posts || [])];
      } else {
        this.posts = result.posts || [];
      }
      this.total = result.total || 0;

      this.loading = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to load posts:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="community-page">
          <div class="error-state">
            <h2>Failed to load community</h2>
            <p>Please try again later</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  private setupEventListeners(): void {
    // Tab buttons
    const tabs = this.$$('.tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabValue = (tab as HTMLElement).dataset.tab as typeof this.activeTab;
        if (tabValue !== this.activeTab) {
          this.activeTab = tabValue;
          this.offset = 0;
          this.loadPosts();
        }
      });
    });

    // Load more button
    const loadMoreBtn = this.$('#load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.offset += this.limit;
        this.loadPosts(true);
      });
    }

    // Create post button
    const createBtn = this.$('#create-post-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.showCreateModal());
    }

    // Close modal
    const closeModal = this.$('#close-modal');
    if (closeModal) {
      closeModal.addEventListener('click', () => this.hideCreateModal());
    }

    // Cancel post
    const cancelBtn = this.$('#cancel-post');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.hideCreateModal());
    }

    // Post type change (show/hide rating)
    const postType = this.$('#post-type') as HTMLSelectElement;
    if (postType) {
      postType.addEventListener('change', () => {
        const ratingGroup = this.$('#rating-group') as HTMLElement;
        if (ratingGroup) {
          ratingGroup.style.display = postType.value === 'review' ? 'block' : 'none';
        }
      });
    }

    // Create post form
    const form = this.$('#create-post-form') as HTMLFormElement;
    if (form) {
      form.addEventListener('submit', (e) => this.handleCreatePost(e));
    }

    // Vote buttons
    const voteButtons = this.$$('.vote-btn');
    voteButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const vote = parseInt((btn as HTMLElement).dataset.vote || '0') as 1 | -1;
        const postId = (btn as HTMLElement).dataset.postId;
        if (postId) {
          this.handleVote(postId, vote);
        }
      });
    });
  }

  private showCreateModal(): void {
    const modal = this.$('#create-post-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  private hideCreateModal(): void {
    const modal = this.$('#create-post-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    // Reset form
    const form = this.$('#create-post-form') as HTMLFormElement;
    if (form) {
      form.reset();
    }
  }

  private async handleCreatePost(e: Event): Promise<void> {
    e.preventDefault();

    const type = (this.$('#post-type') as HTMLSelectElement).value as CommunityPost['type'];
    const title = (this.$('#post-title') as HTMLInputElement).value;
    const content = (this.$('#post-content') as HTMLTextAreaElement).value;
    const rating = type === 'review' ? parseInt((this.$('#post-rating') as HTMLSelectElement).value) : undefined;

    try {
      await communityApi.createPost({
        type,
        title,
        content,
        rating,
      });

      this.hideCreateModal();
      this.offset = 0;
      await this.loadPosts();
    } catch (error) {
      console.error('Failed to create post:', error);
      alert('Failed to create post. Please try again.');
    }
  }

  private async handleVote(postId: string, vote: 1 | -1): Promise<void> {
    if (!authStore.isAuthenticated()) {
      this.navigate('/login');
      return;
    }

    try {
      const result = await communityApi.votePost(postId, vote);

      // Update the vote count in the UI
      const postCard = this.$(`.post-card[data-post-id="${postId}"]`);
      if (postCard) {
        const voteCount = postCard.querySelector('.vote-count');
        if (voteCount) {
          voteCount.textContent = String(result.upvotes - result.downvotes);
        }
      }
    } catch (error) {
      console.error('Failed to vote:', error);
    }
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  private renderSinglePost(): string {
    const post = this.singlePost!;
    const typeLabels: Record<string, string> = {
      discussion: 'Discussion',
      review: 'Review',
      guide: 'Guide',
      artwork: 'Artwork',
      announcement: 'Announcement',
    };

    return `
      <div class="community-page single-post-view">
        <header class="community-header">
          <a href="#/community" class="back-link">← Back to Community</a>
        </header>

        <article class="post-detail">
          <div class="post-header">
            <span class="post-type post-type--${post.type}">${typeLabels[post.type] || post.type}</span>
            ${post.pinned ? '<span class="post-pinned">📌 Pinned</span>' : ''}
            ${post.game ? `<a href="#/game/${post.game.id}" class="post-game">${this.escapeHtml(post.game.title)}</a>` : ''}
          </div>
          <h1 class="post-title">${this.escapeHtml(post.title)}</h1>
          <div class="post-meta">
            <span class="post-author">${post.author?.displayName || 'Anonymous'}</span>
            <span class="post-date">${this.formatDate(post.createdAt)}</span>
            ${post.type === 'review' && post.rating ? `
              <span class="post-rating">${'★'.repeat(post.rating)}${'☆'.repeat(5 - post.rating)}</span>
            ` : ''}
          </div>
          <div class="post-content">
            ${this.escapeHtml(post.content).replace(/\n/g, '<br>')}
          </div>
          <div class="post-footer">
            <div class="post-stats">
              <span class="votes">
                <button class="vote-btn" data-vote="1" data-post-id="${post.id}">👍</button>
                <span class="vote-count">${post.upvotes - post.downvotes}</span>
                <button class="vote-btn" data-vote="-1" data-post-id="${post.id}">👎</button>
              </span>
              <span class="comments">💬 ${post.commentCount} comments</span>
            </div>
          </div>
        </article>

        <section class="comments-section">
          <h2>Comments (${this.postComments.length})</h2>
          ${authStore.isAuthenticated() ? `
            <form id="add-comment-form" class="add-comment-form">
              <textarea id="comment-content" placeholder="Write a comment..." rows="3" required></textarea>
              <button type="submit" class="btn btn-primary">Post Comment</button>
            </form>
          ` : `
            <p class="login-prompt"><a href="#/login">Login</a> to leave a comment</p>
          `}

          <div class="comments-list">
            ${this.postComments.length === 0 ? `
              <p class="no-comments">No comments yet. Be the first to comment!</p>
            ` : this.postComments.map((comment) => this.renderComment(comment)).join('')}
          </div>
        </section>
      </div>
    `;
  }

  private renderComment(comment: CommunityComment): string {
    return `
      <div class="comment" data-comment-id="${comment.id}">
        <div class="comment-meta">
          <span class="comment-author">${comment.author?.displayName || 'Anonymous'}</span>
          <span class="comment-date">${this.formatDate(comment.createdAt)}</span>
        </div>
        <div class="comment-content">${this.escapeHtml(comment.content).replace(/\n/g, '<br>')}</div>
        <div class="comment-actions">
          <button class="vote-btn" data-vote="1" data-comment-id="${comment.id}">👍</button>
          <span class="vote-count">${comment.upvotes - comment.downvotes}</span>
          <button class="vote-btn" data-vote="-1" data-comment-id="${comment.id}">👎</button>
        </div>
      </div>
    `;
  }

  private async loadSinglePost(postId: string): Promise<void> {
    try {
      const result = await communityApi.getPost(postId);
      this.singlePost = result;
      this.postComments = result.comments || [];

      this.loading = false;
      this.element.innerHTML = this.render();
      this.setupSinglePostEventListeners();
    } catch (error) {
      console.error('Failed to load post:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="community-page">
          <div class="error-state">
            <h2>Post not found</h2>
            <p>The post you're looking for doesn't exist or has been removed.</p>
            <a href="#/community" class="btn btn-primary">Back to Community</a>
          </div>
        </div>
      `;
    }
  }

  private setupSinglePostEventListeners(): void {
    // Vote buttons
    const voteButtons = this.$$('.vote-btn');
    voteButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const vote = parseInt((btn as HTMLElement).dataset.vote || '0') as 1 | -1;
        const postId = (btn as HTMLElement).dataset.postId;
        const commentId = (btn as HTMLElement).dataset.commentId;
        if (postId) {
          this.handleVote(postId, vote);
        } else if (commentId) {
          this.handleCommentVote(commentId, vote);
        }
      });
    });

    // Add comment form
    const commentForm = this.$('#add-comment-form') as HTMLFormElement;
    if (commentForm) {
      commentForm.addEventListener('submit', (e) => this.handleAddComment(e));
    }
  }

  private async handleAddComment(e: Event): Promise<void> {
    e.preventDefault();

    if (!this.singlePost) return;

    const contentEl = this.$('#comment-content') as HTMLTextAreaElement;
    const content = contentEl.value.trim();

    if (!content) return;

    try {
      await communityApi.addComment(this.singlePost.id, { content });
      contentEl.value = '';
      // Reload the post to get updated comments
      await this.loadSinglePost(this.singlePost.id);
    } catch (error) {
      console.error('Failed to add comment:', error);
      alert('Failed to add comment. Please try again.');
    }
  }

  private async handleCommentVote(commentId: string, vote: 1 | -1): Promise<void> {
    if (!authStore.isAuthenticated()) {
      this.navigate('/login');
      return;
    }

    try {
      const result = await communityApi.voteComment(commentId, vote);

      // Update the vote count in the UI
      const commentEl = this.$(`.comment[data-comment-id="${commentId}"]`);
      if (commentEl) {
        const voteCount = commentEl.querySelector('.vote-count');
        if (voteCount) {
          voteCount.textContent = String(result.upvotes - result.downvotes);
        }
      }
    } catch (error) {
      console.error('Failed to vote on comment:', error);
    }
  }
}
