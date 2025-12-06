import { useState } from 'react';
import { useViewMode } from '@/hooks/useViewMode';
import ViewToggle from '@/components/ViewToggle';

interface BlogPost {
  id: number;
  title: string;
  content: string;
  author: string;
  date: string;
  comments: number;
  likes: number;
  category: string;
}

interface Announcement {
  id: number;
  title: string;
  content: string;
  date: string;
  type: 'info' | 'update' | 'event';
}

const blogPosts: BlogPost[] = [
  {
    id: 1,
    title: 'Welcome to the WebEDT Community!',
    content: 'We are excited to launch our new community platform where developers, designers, and creators can connect, share ideas, and collaborate on amazing projects. Join the conversation and be part of something special!',
    author: 'WebEDT Team',
    date: '2025-11-20',
    comments: 45,
    likes: 234,
    category: 'Announcement',
  },
  {
    id: 2,
    title: 'New Feature: Real-time Collaboration',
    content: 'Introducing real-time collaboration features! Now you can work together with your team in real-time, share code, and build amazing projects faster than ever before.',
    author: 'Sarah Chen',
    date: '2025-11-18',
    comments: 32,
    likes: 189,
    category: 'Update',
  },
  {
    id: 3,
    title: 'Community Spotlight: Top Projects This Week',
    content: 'Check out the most impressive projects created by our community this week. From stunning portfolios to complex web applications, our users continue to amaze us!',
    author: 'Alex Martinez',
    date: '2025-11-15',
    comments: 28,
    likes: 156,
    category: 'Spotlight',
  },
  {
    id: 4,
    title: 'Upcoming Webinar: Building Scalable Applications',
    content: 'Join us next week for an in-depth webinar on building scalable web applications. Learn best practices, tips, and tricks from industry experts.',
    author: 'Emma Wilson',
    date: '2025-11-12',
    comments: 41,
    likes: 298,
    category: 'Event',
  },
];

const announcements: Announcement[] = [
  {
    id: 1,
    title: 'Platform Maintenance Scheduled',
    content: 'Scheduled maintenance on Nov 25, 2025 from 2:00 AM - 4:00 AM UTC',
    date: '2025-11-21',
    type: 'info',
  },
  {
    id: 2,
    title: 'New Design Templates Available',
    content: 'Check out our latest collection of professional design templates',
    date: '2025-11-19',
    type: 'update',
  },
  {
    id: 3,
    title: 'Community Meetup - Dec 5th',
    content: 'Join us for our monthly virtual community meetup',
    date: '2025-11-17',
    type: 'event',
  },
];

export default function Community() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [viewMode, setViewMode] = useViewMode('community-view');


  // Grid/Card view renderer for blog posts
  const renderCard = (post: BlogPost) => (
    <div key={post.id} className="card bg-base-100 shadow-xl">
      <div className="card-body">
        {/* Category Badge */}
        <div className="flex items-start justify-between">
          <span className="badge badge-primary">{post.category}</span>
          <span className="text-sm text-base-content/50">
            {new Date(post.date).toLocaleDateString()}
          </span>
        </div>

        {/* Title */}
        <h2 className="card-title text-xl mt-2">{post.title}</h2>

        {/* Content Preview */}
        <p className="text-base-content/70 line-clamp-3">{post.content}</p>

        {/* Author and Stats */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-base-300">
          <div className="flex items-center gap-2">
            <div className="avatar placeholder">
              <div className="bg-primary text-primary-content rounded-full w-8">
                <span className="text-xs">{post.author[0]}</span>
              </div>
            </div>
            <span className="text-sm font-medium">{post.author}</span>
          </div>

          <div className="flex gap-4">
            {/* Likes */}
            <button className="flex items-center gap-1 hover:text-primary transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
              </svg>
              <span className="text-sm">{post.likes}</span>
            </button>

            {/* Comments */}
            <button className="flex items-center gap-1 hover:text-primary transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-sm">{post.comments}</span>
            </button>

            {/* Share */}
            <button className="hover:text-primary transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Detailed line view renderer for blog posts
  const renderDetailedRow = (post: BlogPost) => (
    <div
      key={post.id}
      className="p-4 bg-base-100 rounded-lg shadow hover:shadow-lg transition-shadow"
    >
      <div className="flex items-start justify-between mb-2">
        <span className="badge badge-primary badge-sm">{post.category}</span>
        <span className="text-xs text-base-content/50">
          {new Date(post.date).toLocaleDateString()}
        </span>
      </div>

      <h3 className="text-lg font-semibold text-base-content mb-2">{post.title}</h3>
      <p className="text-sm text-base-content/70 mb-3">{post.content}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="avatar placeholder">
            <div className="bg-primary text-primary-content rounded-full w-6">
              <span className="text-xs">{post.author[0]}</span>
            </div>
          </div>
          <span className="text-xs font-medium">{post.author}</span>
        </div>

        <div className="flex gap-3">
          <button className="flex items-center gap-1 text-xs hover:text-primary transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
            <span>{post.likes}</span>
          </button>
          <button className="flex items-center gap-1 text-xs hover:text-primary transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{post.comments}</span>
          </button>
        </div>
      </div>
    </div>
  );

  // Minimal line view renderer for blog posts
  const renderMinimalRow = (post: BlogPost) => (
    <div
      key={post.id}
      className="flex items-center gap-3 p-2 bg-base-100 rounded hover:bg-base-200 transition-colors"
    >
      <span className="badge badge-primary badge-xs">{post.category}</span>

      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-base-content truncate">{post.title}</h3>
      </div>

      <div className="text-xs text-base-content/60 hidden sm:block">{post.author}</div>

      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          {post.likes}
        </span>
        <span className="flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {post.comments}
        </span>
      </div>
    </div>
  );

  const getAnnouncementBadge = (type: string) => {
    switch (type) {
      case 'info':
        return 'badge-info';
      case 'update':
        return 'badge-success';
      case 'event':
        return 'badge-warning';
      default:
        return 'badge-ghost';
    }
  };

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-base-content mb-4">Community Hub</h1>
          <p className="text-base-content/70">
            Stay updated with the latest news, announcements, and community discussions
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - Blog Posts */}
          <div className="lg:col-span-2 space-y-6">
            {/* Category Filters and View Toggle */}
            <div className="flex flex-wrap gap-4 items-center justify-between mb-6">
              <div className="flex gap-2">
                {['All', 'Announcements', 'Updates', 'Events', 'Spotlight'].map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`btn btn-sm ${
                      selectedCategory === category ? 'btn-primary' : 'btn-ghost'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
            </div>

            {/* Blog Posts - Dynamic View */}
            {viewMode === 'grid' && (
              <div className="space-y-6">
                {blogPosts.map((post) => renderCard(post))}
              </div>
            )}
            {viewMode === 'detailed' && (
              <div className="space-y-3">
                {blogPosts.map((post) => renderDetailedRow(post))}
              </div>
            )}
            {viewMode === 'minimal' && (
              <div className="space-y-1">
                {blogPosts.map((post) => renderMinimalRow(post))}
              </div>
            )}

            {/* Placeholder for Chat/Discord Area */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title">Community Chat</h3>
                <p className="text-base-content/70">
                  Join the conversation! Our Discord-style community chat will be available soon.
                  Connect with other developers, ask questions, and share your projects in real-time.
                </p>
                <button className="btn btn-primary mt-4">Coming Soon</button>
              </div>
            </div>
          </div>

          {/* Sidebar - Announcements */}
          <div className="space-y-6">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title text-xl mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                  </svg>
                  Announcements
                </h3>

                <div className="space-y-4">
                  {announcements.map((announcement) => (
                    <div key={announcement.id} className="p-4 bg-base-200 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <span className={`badge badge-sm ${getAnnouncementBadge(announcement.type)}`}>
                          {announcement.type}
                        </span>
                        <span className="text-xs text-base-content/50">
                          {new Date(announcement.date).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="font-semibold text-sm mb-1">{announcement.title}</h4>
                      <p className="text-xs text-base-content/70">{announcement.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Links */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h3 className="card-title text-xl mb-4">Quick Links</h3>
                <div className="space-y-2">
                  <button className="btn btn-ghost btn-sm justify-start w-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 mr-2"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    Documentation
                  </button>
                  <button className="btn btn-ghost btn-sm justify-start w-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 mr-2"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Help & Support
                  </button>
                  <button className="btn btn-ghost btn-sm justify-start w-full">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 mr-2"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <polyline points="17 11 19 13 23 9" />
                    </svg>
                    Report a Bug
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
