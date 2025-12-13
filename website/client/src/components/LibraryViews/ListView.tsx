import { useNavigate } from 'react-router-dom';
import { LibraryItem } from './GridView';

type SortField = 'title' | 'price' | null;
type SortDirection = 'asc' | 'desc' | null;

interface ListViewProps {
  items: LibraryItem[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: Exclude<SortField, null>) => void;
}

export default function ListView({ items, sortField, sortDirection, onSort }: ListViewProps) {
  const navigate = useNavigate();

  const renderSortIcon = (field: Exclude<SortField, null>) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    if (sortDirection === 'asc') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-base-300 rounded-lg font-semibold text-sm mb-2">
        <div className="w-24 h-24"></div> {/* Thumbnail spacer */}
        <button
          onClick={() => onSort('title')}
          className="flex-1 flex items-center gap-2 hover:text-primary transition-colors"
        >
          Title
          {renderSortIcon('title')}
        </button>
        <button
          onClick={() => onSort('price')}
          className="flex items-center gap-2 hover:text-primary transition-colors"
        >
          Price
          {renderSortIcon('price')}
        </button>
        <div className="w-24"></div> {/* Actions spacer */}
      </div>

      {/* Items */}
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-4 p-4 bg-base-100 rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
          onClick={() => navigate(`/library/${item.id}`)}
        >
          {/* Thumbnail */}
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-24 h-24 object-cover rounded"
          />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-base-content">{item.title}</h3>
            <p className="text-sm text-base-content/70 mt-1">{item.description}</p>
            <p className="text-xs text-success font-semibold mt-2">Owned</p>
          </div>

          {/* Price and Actions */}
          <div className="flex items-center gap-4">
            <div className="text-lg font-semibold text-base-content/60">{item.price}</div>
            <div className="flex gap-2">
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
      ))}
    </div>
  );
}
