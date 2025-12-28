/**
 * Diff Parser Utility
 * Parses unified diff format into structured data for visualization
 */

export interface DiffLine {
  type: 'addition' | 'deletion' | 'context' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  hunks: DiffHunk[];
  isBinary: boolean;
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  totalFilesChanged: number;
}

const FILE_HEADER_REGEX = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_FILE_REGEX = /^--- (?:a\/)?(.+)$/;
const NEW_FILE_REGEX = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const BINARY_FILE_REGEX = /^Binary files .+ and .+ differ$/;

export function parseDiff(diffString: string): ParsedDiff {
  const lines = diffString.split('\n');
  const files: FileDiff[] = [];
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for file header
    const fileMatch = line.match(FILE_HEADER_REGEX);
    if (fileMatch) {
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = {
        oldPath: fileMatch[1],
        newPath: fileMatch[2],
        status: 'modified',
        hunks: [],
        isBinary: false,
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      continue;
    }

    // Check for old file path
    const oldMatch = line.match(OLD_FILE_REGEX);
    if (oldMatch && currentFile) {
      if (oldMatch[1] === '/dev/null') {
        currentFile.status = 'added';
        currentFile.oldPath = '';
      }
      continue;
    }

    // Check for new file path
    const newMatch = line.match(NEW_FILE_REGEX);
    if (newMatch && currentFile) {
      if (newMatch[1] === '/dev/null') {
        currentFile.status = 'deleted';
        currentFile.newPath = '';
      }
      continue;
    }

    // Check for binary file
    if (BINARY_FILE_REGEX.test(line) && currentFile) {
      currentFile.isBinary = true;
      continue;
    }

    // Check for hunk header
    const hunkMatch = line.match(HUNK_HEADER_REGEX);
    if (hunkMatch && currentFile) {
      currentHunk = {
        header: line,
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      continue;
    }

    // Parse diff lines
    if (currentHunk && currentFile) {
      if (line.startsWith('+')) {
        const diffLine: DiffLine = {
          type: 'addition',
          content: line.substring(1),
          newLineNumber: newLineNum,
        };
        currentHunk.lines.push(diffLine);
        currentFile.additions++;
        newLineNum++;
      } else if (line.startsWith('-')) {
        const diffLine: DiffLine = {
          type: 'deletion',
          content: line.substring(1),
          oldLineNumber: oldLineNum,
        };
        currentHunk.lines.push(diffLine);
        currentFile.deletions++;
        oldLineNum++;
      } else if (line.startsWith(' ') || line === '') {
        const diffLine: DiffLine = {
          type: 'context',
          content: line.substring(1) || '',
          oldLineNumber: oldLineNum,
          newLineNumber: newLineNum,
        };
        currentHunk.lines.push(diffLine);
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  // Add the last file
  if (currentFile) {
    files.push(currentFile);
  }

  // Calculate totals
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return {
    files,
    totalAdditions,
    totalDeletions,
    totalFilesChanged: files.length,
  };
}

export function formatDiffStats(diff: ParsedDiff): string {
  const { totalFilesChanged, totalAdditions, totalDeletions } = diff;
  const parts: string[] = [];

  parts.push(`${totalFilesChanged} file${totalFilesChanged !== 1 ? 's' : ''} changed`);

  if (totalAdditions > 0) {
    parts.push(`${totalAdditions} insertion${totalAdditions !== 1 ? 's' : ''}(+)`);
  }

  if (totalDeletions > 0) {
    parts.push(`${totalDeletions} deletion${totalDeletions !== 1 ? 's' : ''}(-)`);
  }

  return parts.join(', ');
}

export function getFileStatusLabel(status: FileDiff['status']): string {
  switch (status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'modified':
      return 'Modified';
    case 'renamed':
      return 'Renamed';
    default:
      return 'Changed';
  }
}
