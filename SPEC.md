# WebEDT Platform Specification Document
**Version:** 2.0
**Current Domain:** webedt.etdofresh.com
**Target Domain:** webedt.com

---

## 1. Overview

WebEDT is a web-based game development platform that combines a digital storefront for games with an integrated development environment (IDE). Users can browse and purchase games, manage their library, engage with the community, and create/edit games using a suite of creative tools powered by AI assistance.

### 1.1 User Roles
- **Players:** Browse store, purchase games, manage library, participate in community
- **Editors/Developers:** Full access to the editor suite for game creation
- **Organizations/Studios:** Group accounts that can contain multiple users, own repositories, and publish under a shared identity

### 1.2 Target Platforms
- **Primary:** Chrome (development target)
- **Supported:** Firefox, Safari, Mobile browsers
- **Offline:** Best-effort offline support for Image, Code, Scene, and Sound editors (AI features require connectivity)

### 1.3 Scale Expectations
- **Current:** 1-3 concurrent users
- **Short-term:** Up to 10 users
- **Architecture:** Designed for horizontal scalability
- **Storage:** Few GB per user

---

## 2. Dashboard (Homepage)

### 2.1 Layout
- **Customizable Widget System:**
  - Drag-and-drop widget arrangement
  - Choose which sections appear
  - Save layout per user

### 2.2 Available Widgets/Sections
- **Recently Played:** User's recently played games
- **Editor Quick Access:** Recent sessions, quick-start options
- **Store Highlights:** Featured and new items
- **Library Favorites:** Quick access to favorited items
- **Community Activity:** Recent channel messages
- **Session Activity:** Active/recent editor sessions

### 2.3 Personalization
- Adapts based on user preferences (player vs. editor focus)
- Default landing page configurable in settings

---

## 3. Store (Marketplace)

### 3.1 Layout & Display
- Grid view layout with thumbnails
- Each item displays:
  - Thumbnail image
  - Price (or "Free" badge)
  - "Play Now" button
  - "View Trailer" button/link
  - Wishlist button

### 3.2 Hover Behavior
- **Trailer Auto-play:** When hovering over an item with a trailer, automatically play the trailer video (Netflix/YouTube style)

### 3.3 Search & Filtering
- **Universal Search Box:** Single text input that searches across all fields (title, description, tags, creator, etc.)
- **Filter Dropdowns:** Category, genre, price range, etc.
- **Categories/Tags/Genres:** Admin-configurable taxonomy system for organizing items

### 3.4 Pricing & Commerce
- **Payment Providers:** Stripe and PayPal integration
- **Pricing Options:**
  - Free items
  - Paid items
  - Sales/discounts
  - Bundles (items can also be purchased individually)

### 3.5 Wishlist
- Add items to personal wishlist
- Wishlist notifications (price drops, sales)
- Wishlist visible in user library

### 3.6 Ratings & Reviews
- User rating system (star-based or similar)
- Written reviews
- Review moderation

### 3.7 Creator Analytics
- Views/impressions
- Wishlist adds
- Conversion rates (views to purchases)
- Revenue tracking
- Download/play counts

### 3.8 Publishing Pipeline
- Mechanism for developers to publish projects from editor to store
- Support for publishing as individual or organization/studio

---

## 4. Library

### 4.1 Visibility
- Library link/tab only visible when user is logged in
- Hidden for unauthenticated users

### 4.2 View Options
Three view modes:
1. **Grid View** - Thumbnail-based grid layout
2. **List View** - Standard list with more details
3. **Compact List View** - Dense list for power users

### 4.3 Filtering & Sorting
- All items
- Recently added
- Recently played
- Most used
- Favorites
- By collection/folder
- Wishlisted items

### 4.4 Organization Features
- **Quick Favorite:** Star/favorite icon accessible directly from any view
- **Custom Collections/Folders:** User-created organizational folders
- Pagination or infinite scroll

### 4.5 Cloud Services
- **Cloud Saves:** Synced across devices automatically (web-based games sync inherently)
- **Shared Platform Libraries for Games:**
  - Cloud save API
  - Leaderboards API
  - Achievement system (future)
  - Voice chat library for games (future)

---

## 5. Community

### 5.1 Platform Style
- Discord-like structure with channels
- Text-based messaging (no voice chat in community—reserved for in-game library)

### 5.2 Channel Structure

#### 5.2.1 Default Platform Channels
- **#announcements** - Official platform updates
- **#general** - General discussion
- Additional default channels as needed

#### 5.2.2 Game/Project Channels
- Each published game can have associated channels
- Users can follow/subscribe to game channels
- Suggested channels based on owned games
- Searchable channel directory

#### 5.2.3 Custom/Private Channels
- Organizations can create private channels
- Invite-only channels
- Project-specific collaboration channels (integrates with session collaboration)

### 5.3 Channel Discovery
- Browse all public channels
- Search channels by name/topic
- "Your Games" section showing channels for owned games
- Recommended channels based on activity

### 5.4 Linking & Deep Links
- Link to specific shop items
- Link to specific versions of items
- Link to user profiles
- Link to channels/conversations

### 5.5 User Profiles
- Public user profiles
- Display name, avatar
- Published games/contributions
- Organization affiliations

### 5.6 Moderation
- Basic moderation tools (initial implementation)
- Report system
- Admin/moderator roles
- Expandable as needed

### 5.7 Notifications
- Browser notifications for:
  - Mentions (@username)
  - Replies to messages
  - Channel activity (configurable)

---

## 6. Editor Suite

The editor is the core feature of WebEDT, providing a complete game development environment.

### 6.1 Session Management

#### 6.1.1 Session Concept
- Each session is tied to a Git branch
- User selects a repository and base branch
- System creates a new branch with auto-generated name based on request + base branch
- Session persists across all editor tools (Chat, Code, Images, Sounds, Scenes, Preview)
- **Sessions never auto-expire** - persist until explicitly deleted

#### 6.1.2 Sessions Page
- **New Session Creation:** Easy interface to start new sessions with repo/branch selection
- **Active Sessions List:** Display all currently active sessions
- **Search:** Search through sessions
- **Trash:**
  - Soft delete sessions
  - Restore from trash
  - Permanent deletion option
- **Pagination/Infinite Scroll:** Load more as user scrolls

#### 6.1.3 Session Sidebar
- Accessible from any editor page
- Quick navigation between sessions
- Remembers last-visited page per session (clicking session opens to Chat, Code, Images, etc. based on last view)

#### 6.1.4 Collaboration

**Access Control:**
- Project owner assigns organizations or individual users to project
- Assigned users receive notification (email + in-app) when added
- Direct access via session link for authorized users

**Real-time Sync:**
- Multiple users can join the same session
- Real-time synchronized editing using CRDTs (Conflict-free Replicated Data Types)
- Changes appear/disappear seamlessly as actions occur (no explicit conflict resolution UI)
- See other users' cursors and selections
- Presence indicators (who's online)

**Collaborator Communication:**
- Private channel created for session/project collaboration
- Integrates with Community chat system
- Separate from AI Chat

#### 6.1.5 Undo/Redo
- **Local:** Standard undo/redo stack per user
- **Network/CRDT:** Undo operations become new forward operations (applying inverse changes)

#### 6.1.6 Saving & Commits
- **Explicit Commit:** All changes require explicit "Commit Changes" action
- Commit button available across all editors (Images, Sounds, Scenes, Code)
- Changes staged locally until committed

### 6.2 Chat (AI Assistant)

#### 6.2.1 Purpose
- AI-powered development assistant
- Handles repo creation, file editing, AI-to-AI communication

#### 6.2.2 Interface
- iPhone-style chat message bubbles
- Conversation with AI assistant

#### 6.2.3 Verbosity Modes
- **Verbose Mode:** Shows all steps - repo creation, file edits, AI interactions, etc. (for debugging)
- **Normal Mode:** Summarized view of progress without every micro-step (default for most users)

#### 6.2.4 Chat History
- Persists indefinitely
- Exportable (download chat logs)

#### 6.2.5 Slash Commands
| Command | Description |
|---------|-------------|
| `/link store [item]` | Insert link to store item |
| `/link app [app]` | Insert link to application |
| `/link profile [user]` | Insert link to user profile |
| `/link session [id]` | Insert link to session |
| `/link channel [name]` | Insert link to community channel |

### 6.3 Code Editor

#### 6.3.1 Core Features
- VS Code-style interface (stripped down but fully functional)
- File explorer (create, delete, rename files/folders)
- **Syntax highlighting** for multiple languages:
  - Priority: TypeScript, C#, Lua
  - Additional languages as available
- Multi-file editing

#### 6.3.2 Advanced Editing
- **Multiple Cursors:** Multi-select editing
- **Collaborative Cursors:** See other users' cursor positions (when collaboration enabled)
- **Code Formatting:** Auto-format on save or command
- **Linting Integration:** Real-time error/warning display
- **Snippet/Template Support:** Common code patterns (future enhancement)

#### 6.3.3 Git Integration
- **Diff Visualization:** View changes compared to base branch
- Visual diff highlighting in editor

#### 6.3.4 Integrated Terminal
- Console/terminal access within code editor
- Run commands, view output
- Access to build tools and scripts

#### 6.3.5 Language-Specific Tooling
- **Lua/Love2D:**
  - LÖVE API autocomplete
  - LÖVE documentation integration
  - Lua-specific linting

#### 6.3.6 AI Features
- **Autocomplete:** AI-powered code suggestions
- **AI Input Box:** Text input at bottom of editor
  - Send AI requests to modify current file
  - Modify selected code
  - Powered by same AI provider as Chat

### 6.4 Images

Four sub-sections within the Images tool:

#### 6.4.1 Image Editor

**Canvas:**
- Maximum supported dimensions: 8192 x 8192 (8K)
- **Layer Support:** Multiple layers while editing
  - Standard format support: PSD or ORA (for cross-application compatibility)
  - Flattened on export to PNG/JPEG/etc.

**Tools:**
- Paint/brush tool
- Fill/bucket tool
- Shape tools (square, circle)
- Selection tool
- Move selection tool
- Resize image

**Effects:**
- Grayscale
- Blur
- Pixelate
- Additional standard image effects

**Color Palette System:**
- Create and save custom palettes
- Load existing palettes
- Palette presets (e.g., retro, pastel)
- Color picker with palette integration

**Import:**
- **Clipboard:** Paste images directly (priority)
- **URL:** Import from external URL
- File upload

**Export Formats:**
- PNG
- JPEG
- GIF
- WebP
- PSD/ORA (with layers)

**File Explorer:**
- Browse project images
- Click to open in editor

#### 6.4.2 Sprite Sheet Editor (Texture Packer)

**Packing Features:**
- Select multiple images to pack
- Rotation options for optimal packing
- Output formats:
  - Packed image (PNG/JPEG)
  - Metadata file (JSON, XML, or TXT)
  - Potential single-file format (base64 image + metadata combined)

**Sprite Detection/Slicing:**
- Automatic sprite detection for imported sheets (no metadata)
- Manual slicing options:
  - Number of rows and columns
  - Fixed sprite size
  - Custom regions

**Nine-Slice Support:**
- Define 9-slice regions for UI elements
- Metadata storage for slice boundaries
- Visual nine-slice editor

**Editing Features:**
- Reorder sprites within sheet
- Add new sprites
- Remove sprites
- Move sprite positions

#### 6.4.3 Frame Animation Editor

**Input Sources:**
- Individual images
- Sprite sheet frames (with frame references)

**Timeline Features:**
- Frame-by-frame timeline
- Maximum frame count: 500 frames
- Animation speed/FPS control
- Animation naming

**Advanced Features:**
- **Onion Skinning:** Toggle to see previous/next frames overlaid
- **Easing/Interpolation:** Between keyframes (for transform properties)

**Animation Events:**
- Trigger events at specific frames
- String-named events stored in metadata
- Use for sound triggers, script callbacks, etc.

**Playback:**
- Preview animation in editor
- Loop/ping-pong options

#### 6.4.4 Bone Animation Editor (Separate Subsection)

**Features:**
- Skeletal/bone-based animation system
- Bone hierarchy creation
- **Bone transforms only** (no mesh deformation)
- Keyframe-based bone positioning
- Timeline with bone tracks

**Note:** Kept separate from frame animations for clarity and different workflows.

### 6.5 Sounds

Three sub-sections within the Sounds tool:

#### 6.5.1 Wave Editor

**Supported Formats:**
- MP3
- WAV
- OGG

**Constraints:**
- Maximum file length: 20 minutes
- Typical use case: Seconds to a few minutes

**Features:**
- Waveform visualization
- Clip/trim audio
- Fade in/out
- Reverse
- Normalize
- Additional audio effects

**Recording:**
- Microphone input support
- Record directly into editor

#### 6.5.2 Sound Effects Generator
- SFXR-style procedural sound generator
- Presets for common game sounds (jump, coin, explosion, laser, powerup, hurt, etc.)
- Randomization options
- Parameter tweaking (frequency, envelope, etc.)
- Export to standard formats

#### 6.5.3 Track Editor (Multi-track Mixer/DAW)

**Core Features:**
- Multiple tracks
- Place sound files at specific times on tracks
- Per-track controls:
  - Volume
  - Solo
  - Mute
  - Pan (left/right)
- Timeline scrubbing
- Zoom in/out on timeline

**Music Composition Features:**
- **BPM/Beat Grid:** Snap to beat grid
- Tempo control
- Time signature support
- **MIDI Support:** Import and work with MIDI files

**Export:**
- Mix down to single audio file
- Export individual tracks

### 6.6 Scenes

Two sub-sections integrating Code, Images, and Sounds:

#### 6.6.1 Coordinate System
- **Origin:** Center of screen/viewport (0, 0)
- **2D:** X increases right, Y increases up (standard mathematical)
- **3D:** (Future) Standard right-handed coordinate system
- **Object Pivots:** Each object has configurable pivot/anchor point

#### 6.6.2 Object Editor (Prefabs/Data Objects)

**Core Features:**
- Create reusable game objects (prefabs)
- Component system (similar to Unity/Godot)

**Prefab Variants:**
- Create variants of existing prefabs
- Override specific properties
- Inheritance chain (changes to base propagate to variants unless overridden)

**Component Types:**
- **Transform:** Position, rotation, scale
- **Scripts:** Attach code from Code section
- **Sprite Renderer:** Display images/sprites
- **Animator:** Play animations (frame or bone)
- **Audio Source:** Play sounds
- **Colliders:** Physics collision shapes
- **UI Components:** For UI scenes
- **Custom Components:** User-defined

#### 6.6.3 Scene Editor

**Scene Types:**
- 2D Game scenes
- UI scenes
- 3D scenes (future/low priority)

**Core Features:**
- Place objects in scene
- Position, rotate, scale objects
- **Multi-scene editing:** Open multiple scenes simultaneously (e.g., UI + game scene)
- **Z-ordering:** Layer management for depth sorting
- Parallax effects (implemented via game code using Z-layers)
- Grid snapping (optional)

**UI Scene Features:**
- **Constraint-based Layout System:**
  - Anchors (attach to parent edges/center)
  - Margins and padding
  - Stretch/fit options
  - Responsive design support

**Spawn Points:**
- Creator defines spawn logic via scripts
- Scene provides transform data, scripts handle instantiation

#### 6.6.4 Physics Integration
- Physics system integration (using existing library initially)
- Long-term goal: Custom physics engine
- Rigidbody components
- Collider shapes
- Physics materials

#### 6.6.5 AI Assistance in Scene Editor
- **AI Input Box:** Text input for AI requests
- AI has access to repository and file formats
- Generic AI requests (not tailored scene-specific commands)
- Example: "Generate a forest of trees" → AI creates/places objects based on repo assets

#### 6.6.6 Play Mode vs Edit Mode
- **Toggle between modes**
- **Edit Mode:** Standard scene editing
- **Play Mode:** Run the game/scene
  - Can still select and inspect objects
  - Changes require explicit commit

### 6.7 Preview

#### 6.7.1 Functionality
- Preview current branch state
- URL structure: `webedt.etdofresh.com/github/{owner}/{repo}/{branch}`
- **URLs are public but unlisted** (shareable if you know the link)

#### 6.7.2 Pipeline
1. Session creates new branch
2. Commit pushed to repo
3. GitHub Action triggered
4. Deployment to Docploy
5. Preview available at generated URL

#### 6.7.3 Development Features
- **Hot Reload:** Changes reflect without full page refresh (where possible)
- **Debug Output:** Browser console for logs
- Games can implement in-game debug UI as desired

### 6.8 Target Runtimes

**Currently Supported:**
1. **Web (TypeScript/JavaScript):** HTML, CSS, JS/TS games running directly in browser
2. **Love2D:** Lua games running via Love.js in an embedded panel

**Future/Native Export:**
- Users can export to native platforms (desktop, mobile) outside of WebEDT
- WebEDT focuses on web-based development and preview
- Provide guidance/documentation for native export workflows

**Extensibility:**
- Architecture designed for additional runtimes
- Plugin system for new engines (future)

---

## 7. User Interface Features

### 7.1 Split View
- Open two editor views simultaneously
- Side-by-side editing
- Resizable panels

### 7.2 Themes
- Dark theme
- Light theme
- Additional themes (future)

### 7.3 Navigation
- Responsive header
- Mobile hamburger menu
- Tab-based editor navigation

---

## 8. User Profile & Settings

### 8.1 Account Settings
- Username (unique identifier)
- Display name
- Avatar
- Email

### 8.2 Organization/Studio Accounts

**Structure:**
- Create organizations containing multiple users
- Organizations can own repositories (not just members)
- Publish games under organization name

**Permissions:**
- Role-based permissions within org (owner, admin, member)
- Shared resources and sessions
- Private organization channels

**Billing:**
- Separate billing from individual accounts
- Organization-level payment methods
- Usage tracking per organization

### 8.3 Connections (OAuth Integrations)
- **GitHub** - Required for repo operations
- **Claude** - AI functionality
- **Codex** - AI functionality  
- **Gemini** - AI functionality

### 8.4 AI Provider Selection
- Configure which AI provider to use for:
  - Chat
  - Code assistance
  - Image generation
  - Other AI features

### 8.5 AI Usage Tracking & Limits
- Capture usage data from AI providers
- Display cost/token usage to users
- Usage history and analytics
- **Spending Limits:** Set maximum spend per period in settings
- Alerts when approaching limits

### 8.6 Preferences

#### 8.6.1 Detail Level
- **Verbose:** Maximum detail (debugging mode)
- **Normal:** Standard detail for regular users

#### 8.6.2 Landing Page
- Store (default - optimized for players)
- Editor (for active developers)
- Dashboard (balanced view)

#### 8.6.3 Image Processing
- Maximum image dimension for chat uploads (default: 1024px)
- Auto-resize larger images to reduce bandwidth

#### 8.6.4 Notifications
- Browser notifications enabled/disabled
- Notification triggers:
  - Long-running chat completion
  - Session task completion
  - Community mentions/replies
  - Added to project/session
  - Wishlist item on sale

#### 8.6.5 Voice Commands
- Voice command behaviors (configurable)

### 8.7 Settings Sync
- All settings tied to user account
- Sync across all devices when logged in

### 8.8 Security
- Standard authentication
- Two-factor authentication (future consideration)

---

## 9. Technical Architecture

### 9.1 Git Integration
- All work tied to Git branches
- Auto-generated branch names
- GitHub Actions for CI/CD
- GitHub as primary data backup for user projects
- Support for both individual and organization-owned repositories

### 9.2 Deployment
- GitHub Actions → Docploy pipeline
- Dynamic preview URLs per branch

### 9.3 Database
- User accounts
- Organization accounts
- Sessions
- Published projects (store items)
- Library ownership records
- AI usage tracking
- Analytics data (views, conversions, etc.)
- Community channels and messages

### 9.4 Backup
- Database: Daily backup via Docploy
- User content: Stored in GitHub repositories

### 9.5 Collaboration Infrastructure
- CRDT-based synchronization for real-time collaboration
- WebSocket connections for live updates
- Presence indicators (who's online, cursor positions)
- Seamless merge (no explicit conflict UI—changes appear/disappear naturally)

---

## 10. Appendix

### 10.1 File Format Specifications

#### Layer Format
- **Primary:** ORA (OpenRaster) or PSD for cross-application compatibility
- Preserves layers, blend modes, opacity
- Falls back to flattened PNG/JPEG for standard export

#### Animation Metadata (Frame Animation)
```json
{
  "name": "walk_cycle",
  "type": "frame",
  "fps": 12,
  "frames": [
    { "image": "sprite_sheet.png", "region": [0, 0, 32, 32], "duration": 1 },
    { "image": "sprite_sheet.png", "region": [32, 0, 32, 32], "duration": 1 }
  ],
  "events": [
    { "frame": 3, "name": "footstep" },
    { "frame": 7, "name": "footstep" }
  ],
  "loop": true
}
```

#### Bone Animation Metadata
```json
{
  "name": "character_run",
  "type": "bone",
  "fps": 30,
  "bones": [
    { "name": "root", "parent": null },
    { "name": "spine", "parent": "root" },
    { "name": "arm_l", "parent": "spine" }
  ],
  "keyframes": [
    {
      "time": 0,
      "transforms": {
        "root": { "position": [0, 0], "rotation": 0, "scale": [1, 1] },
        "spine": { "position": [0, 10], "rotation": 5, "scale": [1, 1] }
      }
    }
  ]
}
```

#### Sprite Sheet Metadata
```json
{
  "image": "packed_sprites.png",
  "sprites": [
    { "name": "player_idle", "x": 0, "y": 0, "width": 32, "height": 32, "pivot": [0.5, 0.5] },
    { "name": "player_run_1", "x": 32, "y": 0, "width": 32, "height": 32, "pivot": [0.5, 0.5] }
  ],
  "nineSlice": {
    "button_bg": { "left": 4, "right": 4, "top": 4, "bottom": 4 }
  }
}
```

#### Prefab/Object Format
```json
{
  "name": "Player",
  "variant_of": null,
  "components": [
    {
      "type": "Transform",
      "position": [0, 0],
      "rotation": 0,
      "scale": [1, 1],
      "pivot": [0.5, 0.5]
    },
    {
      "type": "SpriteRenderer",
      "sprite": "sprites/player_idle.png",
      "layer": 10
    },
    {
      "type": "Script",
      "file": "scripts/PlayerController.ts"
    },
    {
      "type": "Collider",
      "shape": "box",
      "size": [32, 48],
      "offset": [0, 0]
    }
  ],
  "children": []
}
```

#### Scene Format
```json
{
  "name": "MainMenu",
  "type": "ui",
  "settings": {
    "resolution": [1920, 1080],
    "backgroundColor": "#1a1a2e"
  },
  "objects": [
    {
      "prefab": "prefabs/Button.json",
      "overrides": {
        "Transform.position": [960, 600]
      },
      "layout": {
        "anchor": "center",
        "margins": { "top": 0, "bottom": 0, "left": 0, "right": 0 }
      }
    }
  ]
}
```

### 10.2 Slash Commands Reference
| Command | Description |
|---------|-------------|
| `/link store [item]` | Insert link to store item |
| `/link app [app]` | Insert link to application |
| `/link profile [user]` | Insert link to user profile |
| `/link session [id]` | Insert link to session |
| `/link channel [name]` | Insert link to community channel |

### 10.3 Keyboard Shortcuts (Proposed)
| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Commit changes |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+/` | Toggle comment (code) |
| `Ctrl+D` | Duplicate selection |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+`` ` | Toggle terminal |
| `Space` | Play/pause (animations, sounds) |
| `Tab` | Toggle play mode (scenes) |

### 10.4 Platform-Provided Game Libraries

Libraries available for games to integrate:

| Library | Description |
|---------|-------------|
| `webedt-cloud-save` | Save/load game data to cloud |
| `webedt-leaderboards` | Global and friend leaderboards |
| `webedt-achievements` | Achievement system (future) |
| `webedt-voice` | Voice chat for multiplayer (future) |

### 10.5 Community Channel Types

| Type | Description |
|------|-------------|
| Platform Default | Official channels (#announcements, #general) |
| Game Channel | Associated with published store item |
| Organization Private | Private to organization members |
| Project Collaboration | Private channel for session collaborators |
