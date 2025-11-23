import SessionLayout from '@/components/SessionLayout';

function PreviewPlaceholder() {
  return (
    <div className="h-full bg-base-300 flex flex-col">
      {/* Main preview area - Game iframe will go here */}
      <div className="flex-1 relative bg-gradient-to-br from-base-200 to-base-300 flex items-center justify-center">
        {/* Placeholder content */}
        <div className="text-center space-y-6">
          {/* Large play button */}
          <div className="w-32 h-32 mx-auto rounded-full bg-base-100/10 backdrop-blur-sm border-2 border-base-content/20 flex items-center justify-center hover:bg-base-100/20 transition-colors cursor-not-allowed">
            <svg className="w-16 h-16 text-base-content/40 ml-2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>

          {/* Text */}
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-base-content/60">No Game Preview Available</h2>
            <p className="text-base-content/40">Game preview will load here</p>
          </div>
        </div>

        {/* Settings icon overlay */}
        <div className="absolute top-4 right-4">
          <button className="btn btn-circle btn-sm bg-base-100/10 backdrop-blur-sm border-base-content/20 hover:bg-base-100/20 cursor-not-allowed">
            <svg className="w-5 h-5 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Game control bar */}
      <div className="bg-base-200 border-t border-base-content/10 px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Left: Playback controls */}
          <div className="flex items-center gap-2">
            {/* Restart */}
            <button className="btn btn-sm btn-circle btn-ghost cursor-not-allowed" title="Restart">
              <svg className="w-4 h-4 text-base-content/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
            </button>

            {/* Play/Pause */}
            <button className="btn btn-sm btn-circle btn-ghost cursor-not-allowed" title="Play/Pause">
              <svg className="w-5 h-5 text-base-content/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>

            {/* Next Frame */}
            <button className="btn btn-sm btn-circle btn-ghost cursor-not-allowed" title="Next Frame">
              <svg className="w-4 h-4 text-base-content/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
              </svg>
            </button>
          </div>

          {/* Center: Scene selector dropdown */}
          <div className="flex-1 flex items-center gap-2">
            <select className="select select-sm bg-base-100/10 border-base-content/20 text-base-content/40 cursor-not-allowed max-w-xs" disabled>
              <option>Recent Scenes</option>
              <option>Scene 1</option>
              <option>Scene 2</option>
              <option>Scene 3</option>
            </select>

            <select className="select select-sm bg-base-100/10 border-base-content/20 text-base-content/40 cursor-not-allowed max-w-xs" disabled>
              <option>All Scenes</option>
              <option>Main Menu</option>
              <option>Level 1</option>
              <option>Level 2</option>
              <option>Boss Fight</option>
            </select>
          </div>

          {/* Right: Volume control */}
          <div className="flex items-center gap-2">
            {/* Mute/Unmute */}
            <button className="btn btn-sm btn-circle btn-ghost cursor-not-allowed" title="Mute/Unmute">
              <svg className="w-5 h-5 text-base-content/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Preview() {
  // Always use SessionLayout to show status bar
  return (
    <SessionLayout>
      <PreviewPlaceholder />
    </SessionLayout>
  );
}
