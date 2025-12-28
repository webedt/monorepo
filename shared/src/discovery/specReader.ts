/**
 * SPEC Reader Service
 * Parses .aidev/SPEC.md and STATUS.md to extract unimplemented features
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logging/logger.js';

import type { SpecTask } from './types.js';
import type { SpecParseResult } from './types.js';

export class SpecReaderService {
  async parse(specPath: string): Promise<SpecParseResult> {
    logger.info('Parsing SPEC file', {
      component: 'SpecReaderService',
      specPath,
    });

    if (!fs.existsSync(specPath)) {
      logger.warn('SPEC file not found', {
        component: 'SpecReaderService',
        specPath,
      });
      return { tasks: [], sections: [] };
    }

    const content = fs.readFileSync(specPath, 'utf-8');
    const tasks: SpecTask[] = [];
    const sections: string[] = [];

    let currentSection = '';
    const lines = content.split('\n');

    for (const line of lines) {
      // Track section headers
      const sectionMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        sections.push(currentSection);
        continue;
      }

      // Look for checkbox items: - [ ] or - [x]
      const checkboxMatch = line.match(/^[\s-]*\[([x\s])\]\s*(.+)$/i);
      if (checkboxMatch) {
        const implemented = checkboxMatch[1].toLowerCase() === 'x';
        const feature = checkboxMatch[2].trim();

        // Extract description from following lines or inline
        const description = this.extractDescription(feature);

        tasks.push({
          feature: this.cleanFeatureName(feature),
          description,
          section: currentSection,
          implemented,
        });
        continue;
      }

      // Look for bullet items that might be features
      const bulletMatch = line.match(/^[\s-]*[-*]\s*\*\*(.+?)\*\*\s*[-:]?\s*(.*)$/);
      if (bulletMatch) {
        const feature = bulletMatch[1].trim();
        const description = bulletMatch[2].trim();

        // Assume bullet items without checkboxes are not implemented
        tasks.push({
          feature,
          description,
          section: currentSection,
          implemented: false,
        });
      }
    }

    logger.info('SPEC parsing complete', {
      component: 'SpecReaderService',
      totalTasks: tasks.length,
      implementedTasks: tasks.filter((t) => t.implemented).length,
      unimplementedTasks: tasks.filter((t) => !t.implemented).length,
    });

    return { tasks, sections };
  }

  async checkStatus(statusPath: string): Promise<Map<string, boolean>> {
    logger.info('Checking STATUS file', {
      component: 'SpecReaderService',
      statusPath,
    });

    const statusMap = new Map<string, boolean>();

    if (!fs.existsSync(statusPath)) {
      logger.warn('STATUS file not found', {
        component: 'SpecReaderService',
        statusPath,
      });
      return statusMap;
    }

    const content = fs.readFileSync(statusPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Look for status indicators: [DONE], [IN PROGRESS], [PENDING], etc.
      const statusMatch = line.match(/\[(DONE|COMPLETE|FINISHED)\]/i);
      const featureMatch = line.match(/[-*]\s*\*\*(.+?)\*\*/);

      if (featureMatch) {
        const feature = featureMatch[1].trim();
        statusMap.set(feature.toLowerCase(), !!statusMatch);
      }

      // Also check checkbox items
      const checkboxMatch = line.match(/^[\s-]*\[([x\s])\]\s*(.+)$/i);
      if (checkboxMatch) {
        const completed = checkboxMatch[1].toLowerCase() === 'x';
        const feature = this.cleanFeatureName(checkboxMatch[2].trim());
        statusMap.set(feature.toLowerCase(), completed);
      }
    }

    return statusMap;
  }

  async getUnimplementedTasks(rootDir: string): Promise<SpecTask[]> {
    const specPath = path.join(rootDir, '.aidev', 'SPEC.md');
    const statusPath = path.join(rootDir, '.aidev', 'STATUS.md');

    const { tasks } = await this.parse(specPath);
    const statusMap = await this.checkStatus(statusPath);

    // Merge status information
    return tasks
      .map((task) => {
        // Check if status file marks it as complete
        const statusComplete = statusMap.get(task.feature.toLowerCase());
        if (statusComplete !== undefined) {
          return { ...task, implemented: statusComplete };
        }
        return task;
      })
      .filter((task) => !task.implemented);
  }

  private cleanFeatureName(feature: string): string {
    // Remove markdown formatting
    return feature
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
      .trim();
  }

  private extractDescription(feature: string): string {
    // If feature contains a colon, split and use second part as description
    const colonIndex = feature.indexOf(':');
    if (colonIndex > 0) {
      return feature.slice(colonIndex + 1).trim();
    }

    // If feature contains a dash, split and use second part as description
    const dashIndex = feature.indexOf(' - ');
    if (dashIndex > 0) {
      return feature.slice(dashIndex + 3).trim();
    }

    return '';
  }
}
