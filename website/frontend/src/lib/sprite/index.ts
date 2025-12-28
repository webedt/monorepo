/**
 * Sprite Library
 * Provides sprite loading, caching, and rendering capabilities
 *
 * @example
 * ```typescript
 * import { SpriteRenderer, getSpriteRenderer } from './lib/sprite';
 *
 * // Using the global renderer
 * const renderer = getSpriteRenderer();
 * await renderer.load('player', 'assets/player.png');
 * renderer.draw(ctx, 'player', { x: 100, y: 100 });
 *
 * // Using a custom renderer instance
 * const customRenderer = new SpriteRenderer();
 * await customRenderer.loadSheet('tiles', 'assets/tileset.png', {
 *   columns: 16,
 *   rows: 16
 * });
 * customRenderer.drawFrame(ctx, 'tiles', 5, { x: 200, y: 200 });
 *
 * // Animated sprites
 * const animatedSprite = renderer.createAnimatedSprite('walk', {
 *   frameStart: 0,
 *   frameEnd: 7,
 *   fps: 12,
 *   loop: true
 * });
 * animatedSprite.play();
 *
 * function gameLoop() {
 *   animatedSprite.update();
 *   animatedSprite.draw(ctx, { x: 100, y: 100 });
 *   requestAnimationFrame(gameLoop);
 * }
 * ```
 */

export {
  // Types
  type SpriteRect,
  type SpriteSheetConfig,
  type SpriteTransform,
  type SpriteRenderOptions,
  type SpriteLoadState,
  type CachedSprite,

  // Classes
  SpriteRenderer,
  AnimatedSprite,

  // Global instance helpers
  getSpriteRenderer,
  setSpriteRenderer,
} from './SpriteRenderer.js';
