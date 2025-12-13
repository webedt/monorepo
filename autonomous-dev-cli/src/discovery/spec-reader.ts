/**
 * Spec Reader Module
 *
 * Reads and parses SPEC.md and STATUS.md files to enable spec-driven
 * autonomous development. The spec defines the roadmap while status
 * tracks implementation progress.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

/**
 * Priority tiers for features (P0 = highest priority)
 */
export type PriorityTier = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Implementation status for a feature
 */
export type ImplementationStatus = 'complete' | 'partial' | 'not_started';

/**
 * A feature from the STATUS.md file
 */
export interface StatusFeature {
  name: string;
  status: ImplementationStatus;
  keyFiles: string[];
  notes: string;
  category: string;
}

/**
 * A priority tier entry from STATUS.md
 */
export interface PriorityFeature {
  feature: string;
  specSection: string;
  tier: PriorityTier;
}

/**
 * Parsed STATUS.md content
 */
export interface ParsedStatus {
  lastUpdated: string;
  priorityTiers: {
    P0: PriorityFeature[];
    P1: PriorityFeature[];
    P2: PriorityFeature[];
    P3: PriorityFeature[];
  };
  features: StatusFeature[];
  changelog: string[];
}

/**
 * A section from SPEC.md
 */
export interface SpecSection {
  sectionNumber: string;
  title: string;
  content: string;
  subsections: SpecSection[];
}

/**
 * Parsed SPEC.md content
 */
export interface ParsedSpec {
  version: string;
  overview: string;
  sections: SpecSection[];
  rawContent: string;
}

/**
 * Combined spec context for task generation
 */
export interface SpecContext {
  spec: ParsedSpec;
  status: ParsedStatus;
  nextTasks: NextTask[];
}

/**
 * A task derived from spec + status analysis
 */
export interface NextTask {
  feature: string;
  priority: PriorityTier;
  specSection: string;
  specContent: string;
  currentStatus: ImplementationStatus;
  existingFiles: string[];
  notes: string;
}

/**
 * Reads and parses the SPEC.md file
 */
export function parseSpecFile(repoPath: string): ParsedSpec | null {
  const specPath = join(repoPath, 'SPEC.md');

  if (!existsSync(specPath)) {
    logger.warn(`SPEC.md not found at ${specPath}`);
    return null;
  }

  try {
    const content = readFileSync(specPath, 'utf-8');
    return parseSpecContent(content);
  } catch (error) {
    logger.error(`Failed to read SPEC.md: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Parses SPEC.md content into structured data
 */
function parseSpecContent(content: string): ParsedSpec {
  const lines = content.split('\n');

  // Extract version
  const versionMatch = content.match(/\*\*Version:\*\*\s*([^\n]+)/);
  const version = versionMatch ? versionMatch[1].trim() : 'unknown';

  // Extract overview (section 1)
  const overviewMatch = content.match(/## 1\. Overview[\s\S]*?(?=## 2\.|$)/);
  const overview = overviewMatch ? overviewMatch[0].trim() : '';

  // Parse all sections
  const sections: SpecSection[] = [];
  const sectionRegex = /^## (\d+(?:\.\d+)*)\.\s+(.+)$/gm;
  let match;

  while ((match = sectionRegex.exec(content)) !== null) {
    const sectionNumber = match[1];
    const title = match[2];
    const startIndex = match.index + match[0].length;

    // Find the end of this section (next ## at same or higher level)
    const nextSectionMatch = content.slice(startIndex).match(/\n## \d/);
    const endIndex = nextSectionMatch
      ? startIndex + nextSectionMatch.index!
      : content.length;

    const sectionContent = content.slice(startIndex, endIndex).trim();

    // Only add top-level sections (single digit)
    if (!sectionNumber.includes('.')) {
      sections.push({
        sectionNumber,
        title,
        content: sectionContent,
        subsections: parseSubsections(sectionContent, sectionNumber),
      });
    }
  }

  return {
    version,
    overview,
    sections,
    rawContent: content,
  };
}

/**
 * Parses subsections within a section
 */
function parseSubsections(content: string, parentSection: string): SpecSection[] {
  const subsections: SpecSection[] = [];
  const subsectionRegex = new RegExp(`^### (${parentSection}\\.\\d+)\\s+(.+)$`, 'gm');
  let match;

  while ((match = subsectionRegex.exec(content)) !== null) {
    const sectionNumber = match[1];
    const title = match[2];
    const startIndex = match.index + match[0].length;

    // Find the end of this subsection
    const nextMatch = content.slice(startIndex).match(/\n### /);
    const endIndex = nextMatch ? startIndex + nextMatch.index! : content.length;

    subsections.push({
      sectionNumber,
      title,
      content: content.slice(startIndex, endIndex).trim(),
      subsections: [],
    });
  }

  return subsections;
}

/**
 * Reads and parses the STATUS.md file
 */
export function parseStatusFile(repoPath: string): ParsedStatus | null {
  const statusPath = join(repoPath, 'STATUS.md');

  if (!existsSync(statusPath)) {
    logger.warn(`STATUS.md not found at ${statusPath}`);
    return null;
  }

  try {
    const content = readFileSync(statusPath, 'utf-8');
    return parseStatusContent(content);
  } catch (error) {
    logger.error(`Failed to read STATUS.md: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Parses STATUS.md content into structured data
 */
function parseStatusContent(content: string): ParsedStatus {
  // Extract last updated date
  const updatedMatch = content.match(/\*\*Last Updated:\*\*\s*([^\n]+)/);
  const lastUpdated = updatedMatch ? updatedMatch[1].trim() : 'unknown';

  // Parse priority tiers
  const priorityTiers = {
    P0: parsePriorityTier(content, 'P0'),
    P1: parsePriorityTier(content, 'P1'),
    P2: parsePriorityTier(content, 'P2'),
    P3: parsePriorityTier(content, 'P3'),
  };

  // Parse implementation status tables
  const features = parseImplementationStatus(content);

  // Parse changelog
  const changelog = parseChangelog(content);

  return {
    lastUpdated,
    priorityTiers,
    features,
    changelog,
  };
}

/**
 * Parses a priority tier section from STATUS.md
 */
function parsePriorityTier(content: string, tier: PriorityTier): PriorityFeature[] {
  const tierLabels: Record<PriorityTier, string> = {
    P0: 'P0 - Core MVP',
    P1: 'P1 - Important',
    P2: 'P2 - Nice to Have',
    P3: 'P3 - Future',
  };

  // Match the priority tier section header, table header row, separator row, and capture table content
  // Table format: | Feature | SPEC Section |
  //               |---------|--------------|
  //               | data    | data         |
  // Note: Using \r?\n for cross-platform (CRLF/LF) compatibility
  // The end boundary \r?\n\r?\n(?=###|$) captures all rows until the blank line before next section
  const tierRegex = new RegExp(
    `### ${tierLabels[tier]}[\\s\\S]*?\\|[^|]+\\|[^|]+\\|\\r?\\n\\|[-]+\\|[-]+\\|\\r?\\n([\\s\\S]*?)\\r?\\n\\r?\\n(?=###|$)`,
    'm'
  );

  const match = content.match(tierRegex);
  if (!match) return [];

  const tableContent = match[1];
  const features: PriorityFeature[] = [];

  // Parse table rows
  const rowRegex = /\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
    const feature = rowMatch[1].trim();
    const specSection = rowMatch[2].trim();

    if (feature && specSection && !feature.startsWith('-')) {
      features.push({
        feature,
        specSection,
        tier,
      });
    }
  }

  return features;
}

/**
 * Parses the implementation status tables from STATUS.md
 */
function parseImplementationStatus(content: string): StatusFeature[] {
  const features: StatusFeature[] = [];

  // Find all category sections with 4-column tables (Feature | Status | Key Files | Notes)
  // Match header row, separator row, and capture table content
  // Note: Using \r?\n for cross-platform (CRLF/LF) compatibility
  // The end boundary \r?\n\r?\n(?=###|## |$) captures all rows until the blank line before next section
  const categoryRegex = /### ([^\r\n]+)\r?\n\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|\r?\n\|[-]+\|[-]+\|[-]+\|[-]+\|\r?\n([\s\S]*?)\r?\n\r?\n(?=###|## |$)/g;
  let categoryMatch;

  while ((categoryMatch = categoryRegex.exec(content)) !== null) {
    const category = categoryMatch[1].trim();
    const tableContent = categoryMatch[2];

    // Skip priority tier sections
    if (category.startsWith('P0') || category.startsWith('P1') || category.startsWith('P2') || category.startsWith('P3')) {
      continue;
    }

    // Parse table rows
    const rowRegex = /\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const name = rowMatch[1].trim();
      const statusStr = rowMatch[2].trim();
      const keyFilesStr = rowMatch[3].trim();
      const notes = rowMatch[4].trim();

      // Skip header rows
      if (name === 'Feature' || name.startsWith('-')) continue;

      // Parse status
      let status: ImplementationStatus = 'not_started';
      if (statusStr.includes('✅') || statusStr.toLowerCase().includes('complete')) {
        status = 'complete';
      } else if (statusStr.includes('🟡') || statusStr.toLowerCase().includes('partial')) {
        status = 'partial';
      }

      // Parse key files
      const keyFiles = keyFilesStr
        .split(',')
        .map((f) => f.replace(/`/g, '').trim())
        .filter((f) => f && f !== '-');

      features.push({
        name,
        status,
        keyFiles,
        notes,
        category,
      });
    }
  }

  return features;
}

/**
 * Parses the changelog section from STATUS.md
 */
function parseChangelog(content: string): string[] {
  const changelogMatch = content.match(/## Changelog[\s\S]*$/);
  if (!changelogMatch) return [];

  const entries: string[] = [];
  const entryRegex = /^### (\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?=### \d{4}|$)/gm;
  let match;

  while ((match = entryRegex.exec(changelogMatch[0])) !== null) {
    entries.push(`${match[1]}:\n${match[2].trim()}`);
  }

  return entries;
}

/**
 * Gets the spec section content for a given section reference
 */
export function getSpecSection(spec: ParsedSpec, sectionRef: string): string | null {
  // Handle references like "6.4.1" or "3"
  const parts = sectionRef.split('.');
  const mainSection = parts[0];

  const section = spec.sections.find((s) => s.sectionNumber === mainSection);
  if (!section) return null;

  if (parts.length === 1) {
    return `## ${section.sectionNumber}. ${section.title}\n\n${section.content}`;
  }

  // Look for subsection
  const subsection = section.subsections.find((s) => s.sectionNumber === sectionRef);
  if (subsection) {
    return `### ${subsection.sectionNumber} ${subsection.title}\n\n${subsection.content}`;
  }

  // If exact subsection not found, return the main section
  return `## ${section.sectionNumber}. ${section.title}\n\n${section.content}`;
}

/**
 * Analyzes spec and status to determine next tasks to implement
 */
export function determineNextTasks(spec: ParsedSpec, status: ParsedStatus, maxTasks: number = 5): NextTask[] {
  const nextTasks: NextTask[] = [];

  // Process priority tiers in order: P0 -> P1 -> P2 -> P3
  const tiers: PriorityTier[] = ['P0', 'P1', 'P2', 'P3'];

  for (const tier of tiers) {
    if (nextTasks.length >= maxTasks) break;

    const tierFeatures = status.priorityTiers[tier];

    for (const pf of tierFeatures) {
      if (nextTasks.length >= maxTasks) break;

      // Find the matching status feature
      const statusFeature = status.features.find(
        (f) => f.name.toLowerCase().includes(pf.feature.toLowerCase().split('(')[0].trim()) ||
               pf.feature.toLowerCase().includes(f.name.toLowerCase())
      );

      // Only include if not complete
      if (statusFeature?.status === 'complete') continue;

      // Get the spec content for this feature
      const specContent = getSpecSection(spec, pf.specSection) || '';

      nextTasks.push({
        feature: pf.feature,
        priority: tier,
        specSection: pf.specSection,
        specContent,
        currentStatus: statusFeature?.status || 'not_started',
        existingFiles: statusFeature?.keyFiles || [],
        notes: statusFeature?.notes || '',
      });
    }
  }

  return nextTasks;
}

/**
 * Loads spec context from a repository path
 */
export function loadSpecContext(repoPath: string, maxTasks: number = 5): SpecContext | null {
  const spec = parseSpecFile(repoPath);
  const status = parseStatusFile(repoPath);

  if (!spec || !status) {
    logger.warn('Could not load spec context - SPEC.md or STATUS.md missing');
    return null;
  }

  const nextTasks = determineNextTasks(spec, status, maxTasks);

  logger.info(`Loaded spec context: ${nextTasks.length} tasks identified from ${status.features.length} tracked features`);

  return {
    spec,
    status,
    nextTasks,
  };
}

/**
 * Updates STATUS.md with new feature status or changelog entry
 */
export function updateStatusFile(
  repoPath: string,
  updates: {
    featureUpdates?: Array<{
      category: string;
      featureName: string;
      newStatus?: ImplementationStatus;
      newKeyFiles?: string[];
      newNotes?: string;
    }>;
    changelogEntry?: string;
    newFeatures?: Array<{
      category: string;
      name: string;
      status: ImplementationStatus;
      keyFiles: string[];
      notes: string;
    }>;
  }
): boolean {
  const statusPath = join(repoPath, 'STATUS.md');

  if (!existsSync(statusPath)) {
    logger.error(`STATUS.md not found at ${statusPath}`);
    return false;
  }

  try {
    let content = readFileSync(statusPath, 'utf-8');

    // Update last updated date
    const today = new Date().toISOString().split('T')[0];
    content = content.replace(
      /\*\*Last Updated:\*\*\s*[^\n]+/,
      `**Last Updated:** ${today}`
    );

    // Update feature statuses
    if (updates.featureUpdates) {
      for (const update of updates.featureUpdates) {
        content = updateFeatureInContent(content, update);
      }
    }

    // Add changelog entry
    if (updates.changelogEntry) {
      content = addChangelogEntry(content, today, updates.changelogEntry);
    }

    // Add new features to appropriate categories
    if (updates.newFeatures) {
      for (const newFeature of updates.newFeatures) {
        content = addNewFeatureToCategory(content, newFeature);
      }
    }

    writeFileSync(statusPath, content, 'utf-8');
    logger.info('STATUS.md updated successfully');
    return true;
  } catch (error) {
    logger.error(`Failed to update STATUS.md: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Updates a specific feature's status in the content
 */
function updateFeatureInContent(
  content: string,
  update: {
    category: string;
    featureName: string;
    newStatus?: ImplementationStatus;
    newKeyFiles?: string[];
    newNotes?: string;
  }
): string {
  const statusEmoji: Record<ImplementationStatus, string> = {
    complete: '✅ Complete',
    partial: '🟡 Partial',
    not_started: '❌ Not Started',
  };

  // Find the feature row and update it
  const featureRegex = new RegExp(
    `(\\|\\s*${escapeRegex(update.featureName)}\\s*\\|)([^|]*)(\\|)([^|]*)(\\|)([^|]*)(\\|)`,
    'g'
  );

  return content.replace(featureRegex, (match, name, status, sep1, files, sep2, notes, end) => {
    const newStatus = update.newStatus ? statusEmoji[update.newStatus] : status.trim();
    const newFiles = update.newKeyFiles ? update.newKeyFiles.map((f) => `\`${f}\``).join(', ') : files.trim();
    const newNotes = update.newNotes !== undefined ? update.newNotes : notes.trim();

    return `${name} ${newStatus} ${sep1} ${newFiles} ${sep2} ${newNotes} ${end}`;
  });
}

/**
 * Adds a new changelog entry
 */
function addChangelogEntry(content: string, date: string, entry: string): string {
  const changelogSection = content.match(/## Changelog[\s\S]*$/);
  if (!changelogSection) {
    // Add changelog section if it doesn't exist
    return content + `\n\n## Changelog\n\n### ${date}\n${entry}\n`;
  }

  // Check if today's entry already exists
  if (content.includes(`### ${date}`)) {
    // Append to existing date entry
    return content.replace(
      new RegExp(`(### ${date}\n)([\\s\\S]*?)(?=### \\d{4}|$)`),
      `$1$2${entry}\n`
    );
  }

  // Add new date entry after ## Changelog
  return content.replace(
    /## Changelog\n/,
    `## Changelog\n\n### ${date}\n${entry}\n`
  );
}

/**
 * Adds a new feature to the appropriate category table
 */
function addNewFeatureToCategory(
  content: string,
  feature: {
    category: string;
    name: string;
    status: ImplementationStatus;
    keyFiles: string[];
    notes: string;
  }
): string {
  const statusEmoji: Record<ImplementationStatus, string> = {
    complete: '✅ Complete',
    partial: '🟡 Partial',
    not_started: '❌ Not Started',
  };

  const newRow = `| ${feature.name} | ${statusEmoji[feature.status]} | ${feature.keyFiles.map((f) => `\`${f}\``).join(', ') || '-'} | ${feature.notes} |`;

  // Find the category section and add the row before the next section
  const categoryRegex = new RegExp(
    `(### ${escapeRegex(feature.category)}[\\s\\S]*?)((?=###)|(?=## )|$)`,
    'm'
  );

  return content.replace(categoryRegex, (match, section, nextSection) => {
    // Find the last row of the table
    const lastRowMatch = section.match(/(\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|)\s*$/);
    if (lastRowMatch) {
      return section.replace(lastRowMatch[0], `${lastRowMatch[0]}\n${newRow}`) + nextSection;
    }
    return match;
  });
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats spec context for inclusion in a prompt
 */
export function formatSpecContextForPrompt(context: SpecContext): string {
  const lines: string[] = [];

  lines.push('## Project Specification Context');
  lines.push('');
  lines.push(`This project follows a specification document (SPEC.md v${context.spec.version}).`);
  lines.push('Implementation progress is tracked in STATUS.md.');
  lines.push('');

  if (context.nextTasks.length > 0) {
    lines.push('### Priority Tasks (from STATUS.md)');
    lines.push('');

    for (const task of context.nextTasks) {
      lines.push(`**${task.priority}: ${task.feature}** (SPEC Section ${task.specSection})`);
      lines.push(`- Current Status: ${task.currentStatus === 'not_started' ? 'Not Started' : task.currentStatus === 'partial' ? 'Partially Implemented' : 'Complete'}`);
      if (task.existingFiles.length > 0) {
        lines.push(`- Existing Files: ${task.existingFiles.join(', ')}`);
      }
      if (task.notes) {
        lines.push(`- Notes: ${task.notes}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Formats a specific task's spec content for the worker prompt
 */
export function formatTaskSpecContext(task: NextTask): string {
  const lines: string[] = [];

  lines.push('## Specification Requirements');
  lines.push('');
  lines.push(`**Feature:** ${task.feature}`);
  lines.push(`**Priority:** ${task.priority}`);
  lines.push(`**Spec Section:** ${task.specSection}`);
  lines.push('');

  if (task.specContent) {
    lines.push('### From SPEC.md:');
    lines.push('');
    lines.push(task.specContent);
    lines.push('');
  }

  if (task.existingFiles.length > 0) {
    lines.push('### Existing Implementation Files:');
    lines.push('');
    for (const file of task.existingFiles) {
      lines.push(`- ${file}`);
    }
    lines.push('');
  }

  if (task.notes) {
    lines.push('### Implementation Notes:');
    lines.push('');
    lines.push(task.notes);
    lines.push('');
  }

  return lines.join('\n');
}
