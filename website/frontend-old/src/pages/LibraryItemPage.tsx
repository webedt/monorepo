import { useParams, useNavigate } from 'react-router-dom';

interface ShopItem {
  id: number;
  title: string;
  description: string;
  price: string;
  thumbnail: string;
}

// Same items as in Library/Store
const libraryItems: ShopItem[] = [
  {
    id: 1,
    title: 'Code Editor Pro',
    description: 'Advanced code editor with syntax highlighting and auto-completion',
    price: '$19.99',
    thumbnail: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=400&h=300&fit=crop',
  },
  {
    id: 2,
    title: 'Data Visualizer',
    description: 'Create stunning data visualizations and interactive charts',
    price: '$24.99',
    thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop',
  },
  {
    id: 3,
    title: 'Project Planner',
    description: 'Manage your projects with powerful planning and tracking tools',
    price: '$18.99',
    thumbnail: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&h=300&fit=crop',
  },
  {
    id: 4,
    title: 'API Tester',
    description: 'Test and debug your APIs with an intuitive interface',
    price: '$23.99',
    thumbnail: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=400&h=300&fit=crop',
  },
  {
    id: 5,
    title: 'Design Studio',
    description: 'Create stunning mockups and prototypes for your projects',
    price: '$19.99',
    thumbnail: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop',
  },
  {
    id: 6,
    title: 'Team Chat',
    description: 'Communicate seamlessly with your team in real-time',
    price: '$24.99',
    thumbnail: 'https://images.unsplash.com/photo-1611606063065-ee7946f0787a?w=400&h=300&fit=crop',
  },
  {
    id: 7,
    title: 'CRM Insights',
    description: 'Manage customer relationships with powerful analytics tools',
    price: '$24.89',
    thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=300&fit=crop',
  },
  {
    id: 8,
    title: 'Web Builder',
    description: 'Create and deploy responsive websites with no-code tools',
    price: '$24.99',
    thumbnail: 'https://images.unsplash.com/photo-1547658719-da2b51169166?w=400&h=300&fit=crop',
  },
];

export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const item = libraryItems.find((item) => item.id === Number(id));

  if (!item) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-base-content mb-4">Item Not Found</h1>
          <button className="btn btn-primary" onClick={() => navigate('/library')}>
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <button
          className="btn btn-ghost mb-6"
          onClick={() => navigate('/library')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 mr-2"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Library
        </button>

        {/* Item Details */}
        <div className="card bg-base-100 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-8">
            {/* Image Section */}
            <div>
              <figure className="rounded-lg overflow-hidden">
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  className="w-full h-96 object-cover"
                />
              </figure>
            </div>

            {/* Details Section */}
            <div className="flex flex-col justify-between">
              <div>
                <h1 className="text-4xl font-bold text-base-content mb-4">
                  {item.title}
                </h1>

                {/* Owned Badge */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="badge badge-success gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    Owned
                  </div>
                  <span className="text-sm text-base-content/60">
                    Purchased for {item.price}
                  </span>
                </div>

                <p className="text-lg text-base-content/70 mb-6">
                  {item.description}
                </p>

                {/* Placeholder Content */}
                <div className="border-t border-base-300 pt-6 mb-6">
                  <h2 className="text-2xl font-semibold mb-4">Features</h2>
                  <ul className="list-disc list-inside space-y-2 text-base-content/70">
                    <li>Full feature access</li>
                    <li>Regular updates and support</li>
                    <li>Cloud synchronization</li>
                    <li>Priority customer service</li>
                  </ul>
                </div>

                <div className="border-t border-base-300 pt-6">
                  <h2 className="text-2xl font-semibold mb-4">Requirements</h2>
                  <ul className="list-disc list-inside space-y-2 text-base-content/70">
                    <li>Modern web browser</li>
                    <li>Stable internet connection</li>
                    <li>Active account</li>
                  </ul>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 mt-8">
                <button className="btn btn-primary flex-1">
                  Launch App
                </button>
                <button className="btn btn-outline flex-1">
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-8 card bg-base-100 shadow-xl p-8">
          <h2 className="text-2xl font-bold mb-4">About This App</h2>
          <p className="text-base-content/70 leading-relaxed">
            This is a placeholder library item page. In a real application, this would contain
            detailed information about the purchased app, including version history, changelog,
            usage statistics, related apps, user ratings and reviews, and comprehensive
            documentation links.
          </p>
        </div>
      </div>
    </div>
  );
}
