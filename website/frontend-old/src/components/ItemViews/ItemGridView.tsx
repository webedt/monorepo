import { ReactNode } from 'react';

export interface ItemGridViewProps<T> {
  items: T[];
  renderCard: (item: T) => ReactNode;
}

export default function ItemGridView<T>({ items, renderCard }: ItemGridViewProps<T>) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((item) => renderCard(item))}
    </div>
  );
}
