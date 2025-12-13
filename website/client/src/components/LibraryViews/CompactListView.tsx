import { useNavigate } from 'react-router-dom';
import { LibraryItem } from './GridView';

type SortField = 'title' | 'price' | null;
type SortDirection = 'asc' | 'desc' | null;

interface CompactListViewProps {
  items: LibraryItem[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: Exclude<SortField, null>) => void;
}

export default function CompactListView({ items, sortField, sortDirection, onSort }: CompactListViewProps) {
  const navigate = useNavigate();

  const renderSortIcon = (field: Exclude<SortField, null>) => {
    if (sortField !== field) {
      return (
        <svg className="w-3 h-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    if (sortDirection === 'asc') {
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      );
    }
    return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  return (
    <div className="space-y-1">
      {/* Compact Header */}
      <div className="flex items-center gap-4 px-4 py-2 bg-base-300 rounded-lg font-semibold text-xs mb-1">
        <div className="w-10 h-10"></div> {/* Thumbnail spacer */}
        <button
          onClick={() => onSort('title')}
          className="flex-1 flex items-center gap-1 hover:text-primary transition-colors"
        >
          Title
          {renderSortIcon('title')}
        </button>
        <button
          onClick={() => onSort('price')}
          className="flex items-center gap-1 hover:text-primary transition-colors"
        >
          Price
          {renderSortIcon('price')}
        </button>
        <div className="w-16"></div> {/* Actions spacer */}
      </div>

      {/* Compact Items */}
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-4 p-3 bg-base-100 rounded hover:bg-base-200 transition-colors cursor-pointer"
          onClick={() => navigate(`/library/${item.id}`)}
        >
          {/* Icon/Thumbnail */}
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-10 h-10 object-cover rounded"
          />

          {/* Title */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-base-content truncate">{item.title}</h3>
          </div>

          {/* Price */}
          <div className="text-xs text-base-content/60">{item.price}</div>

          {/* Quick Actions */}
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-xs btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                console.log('Launch:', item.title);
              }}
              title="Launch"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              className="btn btn-ghost btn-xs btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/library/${item.id}`);
              }}
              title="View Details"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
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
      ))}
    </div>
  );
}
