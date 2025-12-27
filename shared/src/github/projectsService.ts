/**
 * GitHub Projects v2 Service
 * Provides operations for managing GitHub Projects using GraphQL API
 */

import { graphql } from '@octokit/graphql';
import { logger } from '../utils/logging/logger.js';

import type { Project } from './projectsService.types.js';
import type { ProjectField } from './projectsService.types.js';
import type { StatusField } from './projectsService.types.js';
import type { ProjectItem } from './projectsService.types.js';
import type { AddItemResult } from './projectsService.types.js';

type GraphQLClient = typeof graphql;

export class GitHubProjectsService {
  private graphql: GraphQLClient;

  constructor(token: string) {
    this.graphql = graphql.defaults({
      headers: {
        authorization: `token ${token}`,
      },
    });
  }

  async getProject(owner: string, projectNumber: number): Promise<Project> {
    logger.info('Getting project', {
      component: 'GitHubProjectsService',
      owner,
      projectNumber,
    });

    // Try organization first, then user
    let result: GetProjectResponse;
    try {
      result = await this.graphql<GetProjectResponse>(GET_ORG_PROJECT_QUERY, {
        org: owner,
        number: projectNumber,
      });

      if (!result.organization?.projectV2) {
        throw new Error('Project not found in organization');
      }

      return this.mapProject(result.organization.projectV2);
    } catch {
      // Try user project
      result = await this.graphql<GetProjectResponse>(GET_USER_PROJECT_QUERY, {
        login: owner,
        number: projectNumber,
      });

      if (!result.user?.projectV2) {
        throw new Error(`Project #${projectNumber} not found for ${owner}`);
      }

      return this.mapProject(result.user.projectV2);
    }
  }

  async addItemToProject(projectId: string, contentId: string): Promise<AddItemResult> {
    logger.info('Adding item to project', {
      component: 'GitHubProjectsService',
      projectId,
      contentId,
    });

    const result = await this.graphql<AddItemResponse>(ADD_ITEM_MUTATION, {
      projectId,
      contentId,
    });

    if (!result.addProjectV2ItemById?.item) {
      throw new Error('Failed to add item to project');
    }

    logger.info('Item added to project', {
      component: 'GitHubProjectsService',
      itemId: result.addProjectV2ItemById.item.id,
    });

    return {
      itemId: result.addProjectV2ItemById.item.id,
    };
  }

  async updateItemStatus(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void> {
    logger.info('Updating item status', {
      component: 'GitHubProjectsService',
      projectId,
      itemId,
      fieldId,
      optionId,
    });

    await this.graphql<UpdateItemResponse>(UPDATE_ITEM_FIELD_MUTATION, {
      projectId,
      itemId,
      fieldId,
      optionId,
    });

    logger.info('Item status updated', {
      component: 'GitHubProjectsService',
      itemId,
    });
  }

  async listProjectItems(
    projectId: string,
    statusFilter?: string
  ): Promise<ProjectItem[]> {
    logger.debug('Listing project items', {
      component: 'GitHubProjectsService',
      projectId,
      statusFilter,
    });

    const result = await this.graphql<ListItemsResponse>(LIST_ITEMS_QUERY, {
      projectId,
    });

    if (!result.node?.items) {
      return [];
    }

    const items = result.node.items.nodes.map((item) => {
      const statusField = item.fieldValues?.nodes?.find(
        (fv) => fv?.field?.name === 'Status'
      );

      const content = item.content;
      return {
        id: item.id,
        contentId: content?.id || content?.databaseId?.toString() || '',
        contentType: (content?.__typename || 'DraftIssue') as 'Issue' | 'PullRequest' | 'DraftIssue',
        title: content?.title || 'Draft',
        status: statusField?.name,
        statusOptionId: statusField?.optionId,
        number: content?.number,
        state: content?.state,
        body: content?.body,
        labels: content?.labels?.nodes?.map((l) => l.name) || [],
      } as ProjectItem;
    });

    if (statusFilter) {
      return items.filter((item) => item.status === statusFilter);
    }

    return items;
  }

  async getStatusField(projectId: string): Promise<StatusField> {
    logger.debug('Getting status field', {
      component: 'GitHubProjectsService',
      projectId,
    });

    const result = await this.graphql<GetFieldsResponse>(GET_FIELDS_QUERY, {
      projectId,
    });

    if (!result.node?.fields) {
      throw new Error('Project fields not found');
    }

    const statusField = result.node.fields.nodes.find(
      (field) => field.name === 'Status' && field.__typename === 'ProjectV2SingleSelectField'
    );

    if (!statusField || !statusField.options) {
      throw new Error('Status field not found in project');
    }

    return {
      fieldId: statusField.id,
      options: statusField.options.map((opt) => ({
        id: opt.id,
        name: opt.name,
      })),
    };
  }

  async getStatusOptionId(
    projectId: string,
    statusName: string
  ): Promise<{ fieldId: string; optionId: string }> {
    const statusField = await this.getStatusField(projectId);
    const option = statusField.options.find(
      (opt) => opt.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!option) {
      throw new Error(
        `Status "${statusName}" not found. Available: ${statusField.options.map((o) => o.name).join(', ')}`
      );
    }

    return {
      fieldId: statusField.fieldId,
      optionId: option.id,
    };
  }

  async moveItemToStatus(
    projectId: string,
    itemId: string,
    statusName: string
  ): Promise<void> {
    const { fieldId, optionId } = await this.getStatusOptionId(projectId, statusName);
    await this.updateItemStatus(projectId, itemId, fieldId, optionId);
  }

  /**
   * Get project items grouped by status column
   */
  async getItemsByStatus(projectId: string): Promise<Map<string, ProjectItem[]>> {
    const items = await this.listProjectItems(projectId);
    const byStatus = new Map<string, ProjectItem[]>();

    for (const item of items) {
      const status = item.status?.toLowerCase() || 'no status';
      if (!byStatus.has(status)) {
        byStatus.set(status, []);
      }
      byStatus.get(status)!.push(item);
    }

    return byStatus;
  }

  /**
   * Find a project item by issue number
   */
  async findItemByIssueNumber(projectId: string, issueNumber: number): Promise<ProjectItem | undefined> {
    const items = await this.listProjectItems(projectId);
    return items.find((item) => item.number === issueNumber);
  }

  private mapProject(projectData: ProjectV2Data): Project {
    const fields: ProjectField[] = projectData.fields.nodes
      .filter((field) => field.__typename === 'ProjectV2SingleSelectField' || field.__typename === 'ProjectV2Field')
      .map((field) => ({
        id: field.id,
        name: field.name,
        dataType: field.__typename === 'ProjectV2SingleSelectField' ? 'SINGLE_SELECT' : 'TEXT',
        options: field.options?.map((opt) => ({
          id: opt.id,
          name: opt.name,
        })),
      }));

    return {
      id: projectData.id,
      number: projectData.number,
      title: projectData.title,
      url: projectData.url,
      fields,
    };
  }
}

// GraphQL Queries and Mutations

const GET_ORG_PROJECT_QUERY = `
  query GetOrgProject($org: String!, $number: Int!) {
    organization(login: $org) {
      projectV2(number: $number) {
        id
        number
        title
        url
        fields(first: 20) {
          nodes {
            ... on ProjectV2Field {
              id
              name
              __typename
            }
            ... on ProjectV2SingleSelectField {
              id
              name
              __typename
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const GET_USER_PROJECT_QUERY = `
  query GetUserProject($login: String!, $number: Int!) {
    user(login: $login) {
      projectV2(number: $number) {
        id
        number
        title
        url
        fields(first: 20) {
          nodes {
            ... on ProjectV2Field {
              id
              name
              __typename
            }
            ... on ProjectV2SingleSelectField {
              id
              name
              __typename
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const ADD_ITEM_MUTATION = `
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item {
        id
      }
    }
  }
`;

const UPDATE_ITEM_FIELD_MUTATION = `
  mutation UpdateItemField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item {
        id
      }
    }
  }
`;

const LIST_ITEMS_QUERY = `
  query ListItems($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            content {
              ... on Issue {
                id
                number
                title
                body
                state
                __typename
                labels(first: 10) {
                  nodes { name }
                }
              }
              ... on PullRequest {
                id
                number
                title
                body
                state
                __typename
                labels(first: 10) {
                  nodes { name }
                }
              }
              ... on DraftIssue {
                id: databaseId
                title
                body
                __typename
              }
            }
            fieldValues(first: 10) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                  field {
                    ... on ProjectV2SingleSelectField {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_FIELDS_QUERY = `
  query GetFields($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2Field {
              id
              name
              __typename
            }
            ... on ProjectV2SingleSelectField {
              id
              name
              __typename
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

// Response Types

interface ProjectV2Data {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: {
    nodes: Array<{
      id: string;
      name: string;
      __typename: string;
      options?: Array<{ id: string; name: string }>;
    }>;
  };
}

interface GetProjectResponse {
  organization?: {
    projectV2: ProjectV2Data | null;
  };
  user?: {
    projectV2: ProjectV2Data | null;
  };
}

interface AddItemResponse {
  addProjectV2ItemById: {
    item: { id: string } | null;
  };
}

interface UpdateItemResponse {
  updateProjectV2ItemFieldValue: {
    projectV2Item: { id: string };
  };
}

interface ListItemsResponse {
  node: {
    items: {
      nodes: Array<{
        id: string;
        content: {
          id?: string;
          databaseId?: number;
          number?: number;
          title?: string;
          body?: string;
          state?: string;
          __typename: string;
          labels?: {
            nodes: Array<{ name: string }>;
          };
        } | null;
        fieldValues: {
          nodes: Array<{
            name?: string;
            optionId?: string;
            field?: { name: string };
          } | null>;
        } | null;
      }>;
    };
  } | null;
}

interface GetFieldsResponse {
  node: {
    fields: {
      nodes: Array<{
        id: string;
        name: string;
        __typename: string;
        options?: Array<{ id: string; name: string }>;
      }>;
    };
  } | null;
}
