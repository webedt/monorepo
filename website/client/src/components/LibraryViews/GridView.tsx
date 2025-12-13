import { useNavigate } from 'react-router-dom';

export interface LibraryItem {
  id: number;
  title: string;
  description: string;
  price: string;
  thumbnail: string;
  purchasedDate: string;
}

interface GridViewProps {
  items: LibraryItem[];
}

export default function GridView({ items }: GridViewProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((item) => (
        <div
          key={item.id}
          className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow"
        >
          {/* Thumbnail - Clickable to Open */}
          <figure
            className="relative h-48 overflow-hidden cursor-pointer group"
            onClick={() => navigate(`/library/${item.id}`)}
          >
            <img
              src={item.thumbnail}
              alt={item.title}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
              <div className="text-white transform scale-90 group-hover:scale-100 transition-transform duration-300">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-16 w-16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </div>
            </div>
          </figure>

          <div className="card-body p-4">
            {/* Title */}
            <h2 className="card-title text-lg">{item.title}</h2>

            {/* Description */}
            <p className="text-sm text-base-content/70 line-clamp-2 mb-2">
              {item.description}
            </p>

            {/* Price with Icons */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-success font-semibold">Owned</div>
              <div className="flex gap-3">
                {/* Launch Icon */}
                <button
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('Launch:', item.title);
                  }}
                  title="Launch"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>

                {/* Info Icon */}
                <button
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/library/${item.id}`);
                  }}
                  title="View Details"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
