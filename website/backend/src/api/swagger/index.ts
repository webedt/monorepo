/**
 * Swagger/OpenAPI Setup
 * Exports the Swagger UI middleware and OpenAPI specification
 */

import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config.js';

export { swaggerSpec };
export { swaggerUi };

/**
 * Swagger UI options for customization
 */
export const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
  explorer: true,
  customSiteTitle: 'WebEDT API Documentation',
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { font-size: 2rem }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'none',
    filter: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
  },
};
