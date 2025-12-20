import { Link } from 'react-router-dom';

// Mock data - in production these would come from an API
const activities = [
  { id: 1, user: 'JohnDoe', action: 'posted in #general', time: '5 min ago' },
  {
    id: 2,
    user: 'GameDev42',
    action: 'shared a new project',
    time: '15 min ago',
  },
  {
    id: 3,
    user: 'PixelArtist',
    action: 'replied to your comment',
    time: '1 hour ago',
  },
];

export function CommunityActivityWidget() {
  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="flex items-start gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary">
              {activity.user.charAt(0)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-medium">{activity.user}</span>
              <span className="text-base-content/70"> {activity.action}</span>
            </p>
            <p className="text-xs text-base-content/50">{activity.time}</p>
          </div>
        </div>
      ))}
      <Link to="/community" className="btn btn-ghost btn-sm w-full">
        View Community
      </Link>
    </div>
  );
}
