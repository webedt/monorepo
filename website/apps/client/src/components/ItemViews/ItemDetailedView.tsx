import { ReactNode } from 'react';

export interface ItemDetailedViewProps<T> {
  items: T[];
  renderRow: (item: T) => ReactNode;
  renderHeader?: () => ReactNode;
}

export default function ItemDetailedView<T>({ items, renderRow, renderHeader }: ItemDetailedViewProps<T>) {
  return (
    <div className="space-y-3">
      {renderHeader && renderHeader()}
      {items.map((item) => renderRow(item))}
    </div>
  );
}
