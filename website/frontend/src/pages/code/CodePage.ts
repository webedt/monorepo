/**
 * Code Page
 * File browser and code editor for agent sessions
 * Supports offline editing with local caching
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Spinner, toast, OfflineIndicator, MultiCursorEditor, Modal, DiffViewer, LintingPanel, CollaborativeCursors, CommitDialog, AIInputBox } from '../../components';
import type { ChangedFile } from '../../components';
import { sessionsApi, storageWorkerApi } from '../../lib/api';
import { offlineManager, isOffline } from '../../lib/offline';
import { offlineStorage } from '../../lib/offlineStorage';
import { formatByFilename, canFormat } from '../../lib/codeFormatter';
import { LintingService } from '../../lib/linting';
import { editorSettingsStore, presenceStore } from '../../stores';
import type { Session } from '../../types';
import './code.css';
import '../../components/multi-cursor-editor/multi-cursor-editor.css';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface EditorTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  isPreview: boolean;
}

interface CodePageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

export class CodePage extends Page<CodePageOptions> {
  readonly route = '/session/:sessionId/code';
  readonly title = 'Code';
  protected requiresAuth = true;

  private session: Session | null = null;
  private fileTree: FileNode[] = [];
  private tabs: EditorTab[] = [];
  private activeTabIndex = -1;
  private expandedFolders: Set<string> = new Set();
  private isLoading = true;
  private isSaving = false;
  private offlineIndicator: OfflineIndicator | null = null;
  private unsubscribeOffline: (() => void) | null = null;
  private isOfflineMode = false;
  private multiCursorEditor: MultiCursorEditor | null = null;
  private pendingCommitFiles: Map<string, ChangedFile> = new Map();
  private commitDialog: CommitDialog | null = null;
  private commitBtn: Button | null = null;
  private aiInputBox: AIInputBox | null = null;
  private diffModal: Modal | null = null;
  private diffViewer: DiffViewer | null = null;
  private lintingService = new LintingService(300);
  private lintingPanel: LintingPanel | null = null;
  private collaborativeCursors: CollaborativeCursors | null = null;
  private unsubscribePresence: (() => void) | null = null;

  protected render(): string {
    return `
      <div class="code-page">
        <header class="code-header">
          <div class="code-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="code-session-info">
              <h1 class="code-title">Loading...</h1>
              <p class="code-subtitle"></p>
            </div>
          </div>
          <div class="code-header-right">
            <div class="active-users-badge" style="display: none;">
              <div class="active-users-avatars"></div>
              <span class="active-users-count"></span>
            </div>
            <div class="offline-status-badge" style="display: none;">
              <span class="offline-badge">Offline Mode</span>
            </div>
            <div class="undo-redo-controls">
              <button class="undo-btn" data-action="undo" title="Undo (Ctrl+Z)" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 10h10a5 5 0 0 1 5 5v2"></path><polyline points="3 10 7 6"></polyline><polyline points="3 10 7 14"></polyline></svg>
              </button>
              <button class="redo-btn" data-action="redo" title="Redo (Ctrl+Shift+Z)" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 10H11a5 5 0 0 0-5 5v2"></path><polyline points="21 10 17 6"></polyline><polyline points="21 10 17 14"></polyline></svg>
              </button>
            </div>
            <div class="compare-btn-container"></div>
            <div class="format-btn-container"></div>
            <div class="commit-btn-container"></div>
            <div class="save-btn-container"></div>
          </div>
        </header>
        <div class="offline-indicator-container"></div>

        <div class="code-layout">
          <aside class="file-explorer">
            <div class="explorer-header">
              <span class="explorer-title">Files</span>
              <button class="explorer-btn" data-action="refresh" title="Refresh">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              </button>
            </div>
            <div class="file-tree-container">
              <div class="file-tree-loading">
                <div class="spinner-container"></div>
              </div>
              <div class="file-tree" style="display: none;"></div>
              <div class="file-tree-empty" style="display: none;">
                <p>No files found</p>
              </div>
            </div>
          </aside>

          <main class="editor-panel">
            <div class="tabs-bar"></div>
            <div class="editor-area">
              <div class="editor-content">
                <div class="editor-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <p>Select a file to view or edit</p>
                  <p class="editor-hint">Multi-cursor: Alt+Click, Ctrl/Cmd+D (next), Ctrl/Cmd+Shift+L (all)</p>
                </div>
                <div class="editor-wrapper" style="display: none;">
                  <div class="collaborative-cursors-container"></div>
                  <div class="multi-cursor-editor-container"></div>
                </div>
                <div class="preview-wrapper" style="display: none;">
                  <img class="image-preview" alt="Preview">
                </div>
              </div>
              <div class="linting-panel-container"></div>
            </div>
            <div class="ai-input-box-container"></div>
          </main>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Setup back button
    const backBtn = this.$('[data-action="back"]') as HTMLButtonElement;
    if (backBtn) {
      backBtn.addEventListener('click', () => this.navigate(`/session/${this.options.params?.sessionId}/chat`));
    }

    // Setup refresh button
    const refreshBtn = this.$('[data-action="refresh"]') as HTMLButtonElement;
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadFiles());
    }

    // Setup compare button
    const compareBtnContainer = this.$('.compare-btn-container') as HTMLElement;
    if (compareBtnContainer) {
      const compareBtn = new Button('Compare', {
        variant: 'secondary',
        size: 'sm',
        onClick: () => this.showDiffViewer(),
      });
      compareBtn.mount(compareBtnContainer);
    }

    // Setup format button
    const formatBtnContainer = this.$('.format-btn-container') as HTMLElement;
    if (formatBtnContainer) {
      const formatBtn = new Button('Format', {
        variant: 'secondary',
        size: 'sm',
        onClick: () => this.formatCurrentFile(),
      });
      formatBtn.mount(formatBtnContainer);
    }

    // Setup commit button
    const commitBtnContainer = this.$('.commit-btn-container') as HTMLElement;
    if (commitBtnContainer) {
      this.commitBtn = new Button('Commit Changes', {
        variant: 'secondary',
        size: 'sm',
        disabled: true,
        onClick: () => this.openCommitDialog(),
      });
      this.commitBtn.mount(commitBtnContainer);
    }

    // Setup save button
    const saveBtnContainer = this.$('.save-btn-container') as HTMLElement;
    if (saveBtnContainer) {
      const saveBtn = new Button('Save', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.saveCurrentFile(),
      });
      saveBtn.mount(saveBtnContainer);
    }

    // Setup undo/redo buttons (CodeMirror handles undo/redo internally)
    const undoBtn = this.$('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.$('[data-action="redo"]') as HTMLButtonElement;
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.handleUndo());
    }
    if (redoBtn) {
      redoBtn.addEventListener('click', () => this.handleRedo());
    }

    // Initialize MultiCursorEditor
    this.initializeMultiCursorEditor();

    // Setup collaborative cursors container
    // Note: CollaborativeCursors is designed for textarea. For CodeMirror integration,
    // we just mount the container but skip setting the editor element for now.
    const cursorsContainer = this.$('.collaborative-cursors-container') as HTMLElement;
    if (cursorsContainer) {
      this.collaborativeCursors = new CollaborativeCursors();
      this.collaborativeCursors.mount(cursorsContainer);
    }

    // Subscribe to presence updates for the active users badge
    this.unsubscribePresence = presenceStore.subscribe(() => {
      this.updateActiveUsersBadge();
    });

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      const spinner = new Spinner({ size: 'md' });
      spinner.mount(spinnerContainer);
    }

    // Setup offline indicator
    const offlineContainer = this.$('.offline-indicator-container') as HTMLElement;
    if (offlineContainer) {
      this.offlineIndicator = new OfflineIndicator({ position: 'bottom-right' });
      this.offlineIndicator.mount(offlineContainer);
    }

    // Setup linting panel
    const lintingContainer = this.$('.linting-panel-container') as HTMLElement;
    if (lintingContainer) {
      this.lintingPanel = new LintingPanel({
        collapsible: true,
        defaultCollapsed: false,
        maxHeight: 150,
        onDiagnosticClick: (diagnostic) => this.navigateToLine(diagnostic.line, diagnostic.column),
      });
      this.lintingPanel.mount(lintingContainer);
    }

    // Subscribe to offline status changes
    this.unsubscribeOffline = offlineManager.subscribe((status, wasOffline) => {
      this.isOfflineMode = status === 'offline';
      this.updateOfflineUI();

      // If back online and has unsaved changes, attempt to sync
      if (status === 'online' && wasOffline) {
        this.syncPendingChanges();
      }
    });

    // Setup AI Input Box
    const aiInputContainer = this.$('.ai-input-box-container') as HTMLElement;
    const sessionId = this.options.params?.sessionId;
    if (aiInputContainer && sessionId) {
      this.aiInputBox = new AIInputBox({
        sessionId,
        placeholder: 'Ask AI about this code...',
        onNavigateToChat: () => {
          this.navigate(`/session/${sessionId}/chat`);
        },
      });
      this.aiInputBox.mount(aiInputContainer);
    }

    // Load session data
    this.loadSession();
  }

  private async loadSession(): Promise<void> {
    const sessionId = this.options.params?.sessionId;
    if (!sessionId) {
      toast.error('No session ID provided');
      this.navigate('/agents');
      return;
    }

    this.isLoading = true;

    try {
      if (isOffline()) {
        // Try to load from cache
        const cachedSession = await offlineStorage.getCachedSession(sessionId);
        if (cachedSession) {
          this.session = cachedSession as unknown as Session;
          this.updateHeader();
          await this.loadFilesOffline();
          toast.info('Loaded from offline cache');
        } else {
          toast.error('Session not available offline');
          this.navigate('/agents');
        }
        return;
      }

      const response = await sessionsApi.get(sessionId);
      this.session = response.session;

      // Cache session data for offline use
      await offlineStorage.cacheSession(sessionId, response.session as unknown as Record<string, unknown>);

      this.updateHeader();
      await this.loadFiles();

      // Connect to presence for collaborative cursors
      this.connectToPresence();
    } catch (error) {
      // Try offline cache if network fails
      const cachedSession = await offlineStorage.getCachedSession(sessionId);
      if (cachedSession) {
        this.session = cachedSession as unknown as Session;
        this.isOfflineMode = true;
        this.updateHeader();
        this.updateOfflineUI();
        await this.loadFilesOffline();
        toast.info('Loaded from offline cache');
      } else {
        toast.error('Failed to load session');
        console.error('Failed to load session:', error);
        this.navigate('/agents');
      }
    }
  }

  private updateHeader(): void {
    const titleEl = this.$('.code-title');
    const subtitleEl = this.$('.code-subtitle');

    if (this.session) {
      const title = this.session.userRequest?.slice(0, 60) || 'Untitled Session';
      if (titleEl) titleEl.textContent = title;

      const repo = this.session.repositoryOwner && this.session.repositoryName
        ? `${this.session.repositoryOwner}/${this.session.repositoryName}`
        : '';
      const branch = this.session.branch || '';
      const subtitle = [repo, branch].filter(Boolean).join(' • ');
      if (subtitleEl) subtitleEl.textContent = subtitle;
    }
  }

  private async loadFiles(): Promise<void> {
    if (!this.session) return;

    this.isLoading = true;
    this.updateFileTreeState();

    try {
      const sessionPath = this.getSessionPath();
      const response = await storageWorkerApi.listFiles(sessionPath);
      const files = response.files || [];

      // Transform flat file list to tree structure
      this.fileTree = this.buildFileTree(files);
      this.renderFileTree();
    } catch (error) {
      console.error('Failed to load files:', error);
      // Try loading from offline cache
      await this.loadFilesOffline();
    } finally {
      this.isLoading = false;
      this.updateFileTreeState();
    }
  }

  private async loadFilesOffline(): Promise<void> {
    if (!this.session) return;

    this.isLoading = true;
    this.updateFileTreeState();

    try {
      const sessionPath = this.getSessionPath();
      const cachedFiles = await offlineStorage.getSessionFiles(sessionPath);

      if (cachedFiles.length > 0) {
        // Build tree from cached file paths
        this.fileTree = this.buildFileTree(cachedFiles);
        this.renderFileTree();
      } else {
        toast.error('No cached files available');
      }
    } catch (error) {
      console.error('Failed to load cached files:', error);
      toast.error('Failed to load cached files');
    } finally {
      this.isLoading = false;
      this.updateFileTreeState();
    }
  }

  private updateOfflineUI(): void {
    const offlineBadge = this.$('.offline-status-badge') as HTMLElement;
    if (offlineBadge) {
      offlineBadge.style.display = this.isOfflineMode ? 'block' : 'none';
    }
  }

  private async syncPendingChanges(): Promise<void> {
    try {
      const dirtyFiles = await offlineStorage.getDirtyFiles();
      if (dirtyFiles.length === 0) return;

      toast.info(`Syncing ${dirtyFiles.length} file(s)...`);

      for (const file of dirtyFiles) {
        try {
          await storageWorkerApi.writeFile(
            file.sessionPath,
            file.filePath,
            file.content as string
          );
          await offlineStorage.markFileSynced(file.sessionPath, file.filePath);
        } catch (error) {
          console.error(`Failed to sync file ${file.filePath}:`, error);
        }
      }

      toast.success('Changes synced successfully');
    } catch (error) {
      console.error('Failed to sync pending changes:', error);
      toast.error('Failed to sync some changes');
    }
  }

  private getSessionPath(): string {
    if (!this.session) return '';
    const owner = this.session.repositoryOwner || '';
    const repo = this.session.repositoryName || '';
    const branch = this.session.branch || '';
    return `${owner}__${repo}__${branch}`;
  }

  private buildFileTree(files: string[]): FileNode[] {
    const root: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    // Filter out metadata files and workspace prefix
    const processedFiles = files
      .filter(f => !f.includes('.session-metadata.json') && !f.includes('.stream-events.jsonl'))
      .map(f => f.replace(/^workspace\//, ''))
      .filter(f => f.length > 0);

    for (const filePath of processedFiles) {
      const parts = filePath.split('/');
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!nodeMap.has(currentPath)) {
          const node: FileNode = {
            name: part,
            path: currentPath,
            type: isLast ? 'file' : 'directory',
            children: isLast ? undefined : [],
          };
          nodeMap.set(currentPath, node);

          if (parentPath) {
            const parent = nodeMap.get(parentPath);
            if (parent && parent.children) {
              parent.children.push(node);
            }
          } else {
            root.push(node);
          }
        }
      }
    }

    // Sort: directories first, then alphabetically
    const sortNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }).map(node => {
        if (node.children) {
          node.children = sortNodes(node.children);
        }
        return node;
      });
    };

    return sortNodes(root);
  }

  private updateFileTreeState(): void {
    const loading = this.$('.file-tree-loading') as HTMLElement;
    const tree = this.$('.file-tree') as HTMLElement;
    const empty = this.$('.file-tree-empty') as HTMLElement;

    if (this.isLoading) {
      loading?.style.setProperty('display', 'flex');
      tree?.style.setProperty('display', 'none');
      empty?.style.setProperty('display', 'none');
    } else {
      loading?.style.setProperty('display', 'none');
      if (this.fileTree.length === 0) {
        tree?.style.setProperty('display', 'none');
        empty?.style.setProperty('display', 'flex');
      } else {
        tree?.style.setProperty('display', 'block');
        empty?.style.setProperty('display', 'none');
      }
    }
  }

  private renderFileTree(): void {
    const container = this.$('.file-tree') as HTMLElement;
    if (!container) return;

    container.innerHTML = this.renderTreeNodes(this.fileTree, 0);

    // Add click handlers
    container.querySelectorAll('.tree-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = (item as HTMLElement).dataset.path;
        const type = (item as HTMLElement).dataset.type;
        if (path && type === 'file') {
          this.openFile(path);
        } else if (path && type === 'directory') {
          this.toggleFolder(path);
        }
      });
    });
  }

  private renderTreeNodes(nodes: FileNode[], depth: number): string {
    return nodes.map(node => {
      const isExpanded = this.expandedFolders.has(node.path);
      const icon = this.getFileIcon(node);
      const indent = depth * 16;

      if (node.type === 'directory') {
        const chevron = isExpanded ? '▼' : '▶';
        return `
          <div class="tree-item tree-folder ${isExpanded ? 'expanded' : ''}"
               data-path="${node.path}" data-type="directory" style="padding-left: ${indent}px">
            <span class="tree-chevron">${chevron}</span>
            <span class="tree-icon">${icon}</span>
            <span class="tree-name">${this.escapeHtml(node.name)}</span>
          </div>
          ${isExpanded && node.children ? `<div class="tree-children">${this.renderTreeNodes(node.children, depth + 1)}</div>` : ''}
        `;
      } else {
        return `
          <div class="tree-item tree-file" data-path="${node.path}" data-type="file" style="padding-left: ${indent + 16}px">
            <span class="tree-icon">${icon}</span>
            <span class="tree-name">${this.escapeHtml(node.name)}</span>
          </div>
        `;
      }
    }).join('');
  }

  private getFileIcon(node: FileNode): string {
    if (node.type === 'directory') return '📁';

    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const iconMap: Record<string, string> = {
      'js': '🟨',
      'jsx': '⚛️',
      'ts': '🔷',
      'tsx': '⚛️',
      'py': '🐍',
      'json': '📋',
      'md': '📝',
      'css': '🎨',
      'html': '🌐',
      'yml': '⚙️',
      'yaml': '⚙️',
      'sh': '💻',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️',
      'gif': '🖼️',
      'svg': '🖼️',
    };

    return iconMap[ext] || '📄';
  }

  private toggleFolder(path: string): void {
    if (this.expandedFolders.has(path)) {
      this.expandedFolders.delete(path);
    } else {
      this.expandedFolders.add(path);
    }
    this.renderFileTree();
  }

  private async openFile(path: string): Promise<void> {
    // Check if already open
    const existingIndex = this.tabs.findIndex(t => t.path === path);
    if (existingIndex >= 0) {
      this.setActiveTab(existingIndex);
      return;
    }

    // Check if it's an image
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
    if (imageExts.includes(ext)) {
      await this.openImagePreview(path);
      return;
    }

    // Load file content
    try {
      const sessionPath = this.getSessionPath();
      const filePath = `workspace/${path}`;
      let content: string;

      // Try to get from cache first if offline
      if (this.isOfflineMode || isOffline()) {
        const cached = await offlineStorage.getCachedFile(sessionPath, filePath);
        if (cached && cached.contentType === 'text') {
          content = cached.content as string;
        } else {
          throw new Error('File not available offline');
        }
      } else {
        content = await storageWorkerApi.getFileText(sessionPath, filePath);
        // Cache for offline use
        await offlineStorage.cacheFile(sessionPath, filePath, content, 'text');
      }

      const tab: EditorTab = {
        path,
        name: path.split('/').pop() || path,
        content,
        isDirty: false,
        isPreview: true,
      };

      // Replace preview tab or add new
      const previewIndex = this.tabs.findIndex(t => t.isPreview);
      if (previewIndex >= 0) {
        this.tabs[previewIndex] = tab;
        this.setActiveTab(previewIndex);
      } else {
        this.tabs.push(tab);
        this.setActiveTab(this.tabs.length - 1);
      }

      this.renderTabs();
      this.showEditor();

      // Run initial linting
      this.lintCurrentFile();
    } catch (error) {
      console.error('Failed to open file:', error);
      toast.error('Failed to open file');
    }
  }

  private async openImagePreview(path: string): Promise<void> {
    try {
      const sessionPath = this.getSessionPath();
      const blob = await storageWorkerApi.getFileBlob(sessionPath, `workspace/${path}`);
      const url = URL.createObjectURL(blob);

      const preview = this.$('.image-preview') as HTMLImageElement;
      if (preview) {
        preview.src = url;
      }

      this.showPreview();
    } catch (error) {
      console.error('Failed to load image:', error);
      toast.error('Failed to load image');
    }
  }

  private setActiveTab(index: number): void {
    this.activeTabIndex = index;
    this.renderTabs();
    this.updateEditorContent();
    this.updateUndoRedoButtons();

    // Update linting for the new active tab
    this.lintCurrentFile();
  }

  private renderTabs(): void {
    const container = this.$('.tabs-bar') as HTMLElement;
    if (!container) return;

    if (this.tabs.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.tabs.map((tab, i) => `
      <div class="tab ${i === this.activeTabIndex ? 'active' : ''} ${tab.isPreview ? 'preview' : ''}" data-index="${i}">
        <span class="tab-name">${tab.isDirty ? '● ' : ''}${this.escapeHtml(tab.name)}</span>
        <button class="tab-close" data-action="close-tab" data-index="${i}">×</button>
      </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).dataset.action !== 'close-tab') {
          const index = parseInt((tab as HTMLElement).dataset.index || '0');
          this.setActiveTab(index);
        }
      });

      tab.addEventListener('dblclick', () => {
        const index = parseInt((tab as HTMLElement).dataset.index || '0');
        if (this.tabs[index]) {
          this.tabs[index].isPreview = false;
          this.renderTabs();
        }
      });
    });

    container.querySelectorAll('[data-action="close-tab"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt((btn as HTMLElement).dataset.index || '0');
        this.closeTab(index);
      });
    });
  }

  private closeTab(index: number): void {
    const tab = this.tabs[index];
    if (tab?.isDirty) {
      if (!confirm('You have unsaved changes. Close anyway?')) {
        return;
      }
    }

    this.tabs.splice(index, 1);

    if (this.tabs.length === 0) {
      this.activeTabIndex = -1;
      this.showEmpty();
    } else if (this.activeTabIndex >= this.tabs.length) {
      this.activeTabIndex = this.tabs.length - 1;
    } else if (this.activeTabIndex > index) {
      this.activeTabIndex--;
    }

    this.renderTabs();
    this.updateEditorContent();
    this.updateUndoRedoButtons();
  }

  private updateEditorContent(): void {
    if (!this.multiCursorEditor) return;

    if (this.activeTabIndex >= 0 && this.tabs[this.activeTabIndex]) {
      const tab = this.tabs[this.activeTabIndex];

      // Use loadContent to reset history when switching tabs
      // This prevents undo history from being shared across tabs
      const ext = tab.path.split('.').pop()?.toLowerCase() || 'text';
      this.multiCursorEditor.loadContent(tab.content, ext);

      this.showEditor();
      this.multiCursorEditor.focus();
    } else {
      this.multiCursorEditor.loadContent('', 'text');
      this.showEmpty();
    }
  }

  private showEmpty(): void {
    (this.$('.editor-empty') as HTMLElement)?.style.setProperty('display', 'flex');
    (this.$('.editor-wrapper') as HTMLElement)?.style.setProperty('display', 'none');
    (this.$('.preview-wrapper') as HTMLElement)?.style.setProperty('display', 'none');
    // Clear linting panel when no file is open
    this.lintingPanel?.clear();
  }

  private showEditor(): void {
    (this.$('.editor-empty') as HTMLElement)?.style.setProperty('display', 'none');
    (this.$('.editor-wrapper') as HTMLElement)?.style.setProperty('display', 'block');
    (this.$('.preview-wrapper') as HTMLElement)?.style.setProperty('display', 'none');
  }

  private showPreview(): void {
    (this.$('.editor-empty') as HTMLElement)?.style.setProperty('display', 'none');
    (this.$('.editor-wrapper') as HTMLElement)?.style.setProperty('display', 'none');
    (this.$('.preview-wrapper') as HTMLElement)?.style.setProperty('display', 'flex');
    // Clear linting panel for non-text files
    this.lintingPanel?.clear();
  }

  /**
   * Initialize the MultiCursorEditor component
   */
  private initializeMultiCursorEditor(): void {
    const container = this.$('.multi-cursor-editor-container') as HTMLElement;
    if (!container) return;

    this.multiCursorEditor = new MultiCursorEditor({
      content: '',
      language: 'text',
      readOnly: false,
      lineNumbers: true,
      onChange: (content: string) => {
        this.handleEditorChange(content);
      },
      onSave: () => {
        this.saveCurrentFile();
      },
    });

    this.multiCursorEditor.mount(container);
  }

  /**
   * Handle editor content changes from the MultiCursorEditor
   */
  private handleEditorChange(content: string): void {
    if (this.activeTabIndex < 0) return;

    const tab = this.tabs[this.activeTabIndex];
    if (tab && content !== tab.content) {
      tab.content = content;
      tab.isDirty = true;
      tab.isPreview = false;
      this.renderTabs();
      this.updateUndoRedoButtons();

      // Trigger linting
      this.lintCurrentFile();
    }
  }

  private lintCurrentFile(): void {
    if (this.activeTabIndex < 0) {
      this.lintingPanel?.clear();
      return;
    }

    const tab = this.tabs[this.activeTabIndex];
    if (!tab) {
      this.lintingPanel?.clear();
      return;
    }

    this.lintingService.lint(tab.content, tab.name, (result) => {
      this.lintingPanel?.update(result, tab.name);
    });
  }

  private navigateToLine(line: number, column: number): void {
    if (!this.multiCursorEditor || this.activeTabIndex < 0) return;

    const tab = this.tabs[this.activeTabIndex];
    if (!tab) return;

    // Use MultiCursorEditor's scrollToLine method
    this.multiCursorEditor.scrollToLine(line);

    // Set cursor position at the line/column
    const position = this.multiCursorEditor.getPositionFromLineColumn(line, column);
    this.multiCursorEditor.setCursorPosition(position);
    this.multiCursorEditor.focus();
  }

  /**
   * Trigger undo in the editor
   */
  private handleUndo(): void {
    if (!this.multiCursorEditor || this.activeTabIndex < 0) return;
    this.multiCursorEditor.undoChange();
    this.updateUndoRedoButtons();
  }

  /**
   * Trigger redo in the editor
   */
  private handleRedo(): void {
    if (!this.multiCursorEditor || this.activeTabIndex < 0) return;
    this.multiCursorEditor.redoChange();
    this.updateUndoRedoButtons();
  }

  /**
   * Update the undo/redo button states based on editor history
   */
  private updateUndoRedoButtons(): void {
    const undoBtn = this.$('[data-action="undo"]') as HTMLButtonElement;
    const redoBtn = this.$('[data-action="redo"]') as HTMLButtonElement;

    const hasActiveFile = this.activeTabIndex >= 0 && this.tabs[this.activeTabIndex];

    if (undoBtn) {
      undoBtn.disabled = !hasActiveFile || !this.multiCursorEditor?.canUndo();
    }
    if (redoBtn) {
      redoBtn.disabled = !hasActiveFile || !this.multiCursorEditor?.canRedo();
    }
  }

  private showDiffViewer(): void {
    if (!this.session) {
      toast.error('No session loaded');
      return;
    }

    const { repositoryOwner, repositoryName, branch, baseBranch } = this.session;

    if (!repositoryOwner || !repositoryName) {
      toast.error('Repository information not available');
      return;
    }

    if (!branch) {
      toast.error('Current branch not available');
      return;
    }

    // Use main or master as default base branch if not specified
    const base = baseBranch || 'main';

    // Check if comparing the same branch
    if (branch === base) {
      toast.info('Current branch is the same as base branch');
      return;
    }

    // Create and show the modal
    this.diffModal = new Modal({
      title: 'Branch Comparison',
      size: 'xl',
      onClose: () => {
        // Clean up DiffViewer component when modal closes
        if (this.diffViewer) {
          this.diffViewer.unmount();
          this.diffViewer = null;
        }
        this.diffModal = null;
      },
    });

    this.diffViewer = new DiffViewer({
      owner: repositoryOwner,
      repo: repositoryName,
      baseBranch: base,
      headBranch: branch,
    });

    // Mount the modal first so body element exists
    this.diffModal.mount(document.body);
    // Get the modal body element and mount DiffViewer to it
    const bodyElement = this.diffModal.getElement().querySelector('.modal-body');
    if (bodyElement) {
      this.diffViewer.mount(bodyElement as HTMLElement);
    }
    this.diffModal.open();
  }

  private formatCurrentFile(): void {
    if (this.activeTabIndex < 0 || !this.multiCursorEditor) return;

    const tab = this.tabs[this.activeTabIndex];
    if (!tab) return;

    // Check if this file type can be formatted
    if (!canFormat(tab.name)) {
      toast.info('Formatting not supported for this file type');
      return;
    }

    const settings = editorSettingsStore.getSettings();
    const result = formatByFilename(tab.content, tab.name, {
      tabSize: settings.tabSize,
      useTabs: settings.useTabs,
    });

    if (!result.success) {
      toast.error(result.error || 'Failed to format file');
      return;
    }

    // Only update if content actually changed
    if (result.content !== tab.content) {
      const cursorPosition = this.multiCursorEditor.getCursorPosition();

      tab.content = result.content;
      tab.isDirty = true;
      tab.isPreview = false;

      // Update editor content using setContent (adds to undo history)
      this.multiCursorEditor.setContent(result.content);

      // Try to restore cursor position, clamped to new content length
      const newPosition = Math.min(cursorPosition, result.content.length);
      this.multiCursorEditor.setCursorPosition(newPosition);

      this.renderTabs();
      this.updateUndoRedoButtons();
      toast.success('File formatted');
    } else {
      toast.info('File already formatted');
    }
  }

  private async saveCurrentFile(): Promise<void> {
    if (this.activeTabIndex < 0 || this.isSaving) return;

    const tab = this.tabs[this.activeTabIndex];
    if (!tab || !tab.isDirty) {
      toast.info('No changes to save');
      return;
    }

    // Format on save if enabled
    if (editorSettingsStore.getFormatOnSave() && canFormat(tab.name) && this.multiCursorEditor) {
      const settings = editorSettingsStore.getSettings();
      const result = formatByFilename(tab.content, tab.name, {
        tabSize: settings.tabSize,
        useTabs: settings.useTabs,
      });

      if (result.success && result.content !== tab.content) {
        tab.content = result.content;
        this.multiCursorEditor.setContent(result.content);
        this.updateUndoRedoButtons();
      } else if (!result.success) {
        // Warn user that formatting failed but continue with save
        toast.warning(`Could not format: ${result.error || 'Unknown error'}`);
      }
    }

    this.isSaving = true;

    try {
      const sessionPath = this.getSessionPath();
      const filePath = `workspace/${tab.path}`;

      if (this.isOfflineMode || isOffline()) {
        // Save locally for later sync
        await offlineStorage.saveFileLocally(sessionPath, filePath, tab.content, 'text');
        tab.isDirty = false;
        this.renderTabs();
        // Track for commit
        this.trackFileForCommit(tab.path, tab.content, 'modified');
        toast.success('File saved locally (will sync when online)');
      } else {
        try {
          await storageWorkerApi.writeFile(sessionPath, filePath, tab.content);
          // Also cache the latest version
          await offlineStorage.cacheFile(sessionPath, filePath, tab.content, 'text');
          tab.isDirty = false;
          this.renderTabs();
          // Track for commit
          this.trackFileForCommit(tab.path, tab.content, 'modified');
          toast.success('File saved');
        } catch {
          // If save fails, save locally
          await offlineStorage.saveFileLocally(sessionPath, filePath, tab.content, 'text');
          tab.isDirty = false;
          this.renderTabs();
          // Track for commit
          this.trackFileForCommit(tab.path, tab.content, 'modified');
          toast.info('Saved locally (will sync when online)');
        }
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      toast.error('Failed to save file');
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Connect to presence service for collaborative cursors
   */
  private connectToPresence(): void {
    if (!this.session) return;

    const owner = this.session.repositoryOwner;
    const repo = this.session.repositoryName;
    const branch = this.session.branch;

    if (owner && repo && branch) {
      presenceStore.connect(owner, repo, branch).catch(error => {
        console.error('Failed to connect to presence:', error);
      });
    }
  }

  /**
   * Update the active users badge in the header
   */
  private updateActiveUsersBadge(): void {
    const badge = this.$('.active-users-badge') as HTMLElement;
    const avatarsContainer = this.$('.active-users-avatars') as HTMLElement;
    const countEl = this.$('.active-users-count') as HTMLElement;

    if (!badge || !avatarsContainer || !countEl) return;

    const users = presenceStore.getOtherUsersWithColors();

    if (users.length === 0) {
      badge.style.display = 'none';
      return;
    }

    badge.style.display = 'flex';

    // Show up to 3 user avatars
    const displayUsers = users.slice(0, 3);
    const remainingCount = users.length - displayUsers.length;

    avatarsContainer.innerHTML = displayUsers.map(user => {
      const initial = (user.displayName || 'U').charAt(0).toUpperCase();
      return `<div class="active-user-avatar" style="background-color: ${user.color}" title="${this.escapeHtml(user.displayName)}">${initial}</div>`;
    }).join('');

    if (remainingCount > 0) {
      countEl.textContent = `+${remainingCount} more`;
      countEl.style.display = 'inline';
    } else {
      countEl.style.display = 'none';
    }
  }

  private trackFileForCommit(path: string, content: string, status: 'modified' | 'added' | 'deleted'): void {
    this.pendingCommitFiles.set(path, { path, content, status });
    this.updateCommitButton();
  }

  private updateCommitButton(): void {
    if (!this.commitBtn) return;

    const pendingCount = this.pendingCommitFiles.size;
    const hasGitHub = !!(this.session?.repositoryOwner && this.session?.repositoryName);

    if (pendingCount > 0 && hasGitHub) {
      this.commitBtn.setDisabled(false);
      this.commitBtn.setLabel(`Commit Changes (${pendingCount})`);
    } else {
      this.commitBtn.setDisabled(true);
      this.commitBtn.setLabel('Commit Changes');
    }
  }

  private openCommitDialog(): void {
    if (!this.session?.repositoryOwner || !this.session?.repositoryName) {
      toast.error('GitHub repository not connected');
      return;
    }

    if (this.pendingCommitFiles.size === 0) {
      toast.info('No changes to commit');
      return;
    }

    this.commitDialog = new CommitDialog({
      owner: this.session.repositoryOwner,
      repo: this.session.repositoryName,
      branch: this.session.branch || 'main',
      onCommitSuccess: () => {
        // Clear pending files after successful commit
        // (CommitDialog already shows success toast)
        this.pendingCommitFiles.clear();
        this.updateCommitButton();
      },
      onClose: () => {
        this.commitDialog = null;
      },
    });

    this.commitDialog.setChangedFiles(Array.from(this.pendingCommitFiles.values()));
    this.commitDialog.open();
  }

  protected onUnmount(): void {
    // Check for unsaved changes
    const hasUnsaved = this.tabs.some(t => t.isDirty);
    if (hasUnsaved) {
      console.warn('Leaving with unsaved changes');
    }

    // Check for uncommitted changes
    if (this.pendingCommitFiles.size > 0) {
      console.warn('Leaving with uncommitted changes');
    }

    // Cleanup commit dialog
    if (this.commitDialog) {
      this.commitDialog.close();
      this.commitDialog = null;
    }

    // Cleanup MultiCursorEditor
    if (this.multiCursorEditor) {
      this.multiCursorEditor.unmount();
      this.multiCursorEditor = null;
    }

    // Cleanup offline subscription
    if (this.unsubscribeOffline) {
      this.unsubscribeOffline();
      this.unsubscribeOffline = null;
    }

    // Cleanup offline indicator
    if (this.offlineIndicator) {
      this.offlineIndicator.unmount();
      this.offlineIndicator = null;
    }

    // Cleanup diff viewer and modal
    if (this.diffViewer) {
      this.diffViewer.unmount();
      this.diffViewer = null;
    }
    if (this.diffModal) {
      this.diffModal.close();
      this.diffModal.unmount();
      this.diffModal = null;
    }

    // Cleanup AI Input Box
    if (this.aiInputBox) {
      this.aiInputBox.unmount();
      this.aiInputBox = null;
    }

    // Cleanup linting panel
    if (this.lintingPanel) {
      this.lintingPanel.unmount();
      this.lintingPanel = null;
    }
    this.lintingService.clear();

    // Cleanup presence subscription
    if (this.unsubscribePresence) {
      this.unsubscribePresence();
      this.unsubscribePresence = null;
    }

    // Disconnect from presence
    presenceStore.disconnect();

    // Cleanup collaborative cursors
    if (this.collaborativeCursors) {
      this.collaborativeCursors.unmount();
      this.collaborativeCursors = null;
    }
  }
}
