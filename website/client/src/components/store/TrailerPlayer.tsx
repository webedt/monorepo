import { useRef, useEffect, useState, useCallback } from 'react';

export interface TrailerPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  className?: string;
  onLoadedData?: () => void;
  onError?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
}

/**
 * TrailerPlayer component for video playback.
 * Supports auto-play, custom controls, and various event callbacks.
 * Used for both inline trailer preview and modal full playback.
 */
export default function TrailerPlayer({
  src,
  poster,
  autoPlay = false,
  muted = true,
  loop = true,
  controls = false,
  className = '',
  onLoadedData,
  onError,
  onPlay,
  onPause,
  onEnded,
}: TrailerPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(muted ? 0 : 1);
  const [isMuted, setIsMuted] = useState(muted);

  // Handle video loaded
  const handleLoadedData = useCallback(() => {
    setIsLoaded(true);
    setHasError(false);
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
    onLoadedData?.();
  }, [onLoadedData]);

  // Handle video error
  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(false);
    onError?.();
  }, [onError]);

  // Handle play event
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    onPlay?.();
  }, [onPlay]);

  // Handle pause event
  const handlePause = useCallback(() => {
    setIsPlaying(false);
    onPause?.();
  }, [onPause]);

  // Handle ended event
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    onEnded?.();
  }, [onEnded]);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  // Play video
  const play = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked by browser
        setHasError(true);
      });
    }
  }, []);

  // Pause video
  const pause = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }, []);

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Seek to position
  const seek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // Handle progress bar click
  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!videoRef.current || duration === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      seek(pos * duration);
    },
    [duration, seek]
  );

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
      if (!isMuted) {
        setVolume(0);
      } else {
        setVolume(1);
        videoRef.current.volume = 1;
      }
    }
  }, [isMuted]);

  // Set volume
  const handleVolumeChange = useCallback((newVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
    }
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  }, []);

  // Auto-play on mount if enabled
  useEffect(() => {
    if (autoPlay && videoRef.current && isLoaded) {
      play();
    }
  }, [autoPlay, isLoaded, play]);

  // Format time (mm:ss)
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`relative group ${className}`}>
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted={isMuted}
        loop={loop}
        playsInline
        preload="metadata"
        className="w-full h-full object-cover"
        onLoadedData={handleLoadedData}
        onError={handleError}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onClick={controls ? togglePlay : undefined}
      />

      {/* Loading State */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="loading loading-spinner loading-lg text-white"></div>
        </div>
      )}

      {/* Error State */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 mb-2 text-error"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm">Failed to load video</p>
        </div>
      )}

      {/* Playing Indicator (when controls disabled) */}
      {!controls && isPlaying && isLoaded && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-1 rounded text-white text-xs">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
          <span>Playing</span>
        </div>
      )}

      {/* Custom Controls (when enabled) */}
      {controls && isLoaded && !hasError && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {/* Progress Bar */}
          <div
            className="w-full h-1 bg-white/30 rounded-full cursor-pointer mb-3"
            onClick={handleProgressClick}
          >
            <div
              className="h-full bg-primary rounded-full relative"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full shadow-lg"></div>
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              {/* Play/Pause Button */}
              <button
                className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white/20"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Volume Control */}
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white/20"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-20 h-1 accent-primary cursor-pointer"
                  aria-label="Volume"
                />
              </div>

              {/* Time Display */}
              <span className="text-sm tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Fullscreen Button */}
            <button
              className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white/20"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
