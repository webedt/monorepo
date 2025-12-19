import { ReactNode } from 'react';
import type { StoreItem } from '@/types/store';

export interface StoreGridProps {
  items: StoreItem[];
  renderCard: (item: StoreItem) => ReactNode;
  columns?: 2 | 3 | 4 | 5;
  gap?: 4 | 6 | 8;
}

/**
 * StoreGrid component for displaying store items in a responsive grid layout.
 * Supports configurable columns and gap sizes for different screen sizes.
 */
export default function StoreGrid({
  items,
  renderCard,
  columns = 4,
  gap = 6,
}: StoreGridProps) {
  // Map columns to Tailwind classes
  const columnsClasses: Record<number, string> = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    5: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  };

  // Map gap to Tailwind classes
  const gapClasses: Record<number, string> = {
    4: 'gap-4',
    6: 'gap-6',
    8: 'gap-8',
  };

  return (
    <div className={`grid ${columnsClasses[columns]} ${gapClasses[gap]}`}>
      {items.map((item) => renderCard(item))}
    </div>
  );
}
