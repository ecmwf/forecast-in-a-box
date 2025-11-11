/**
 * Runtime Configuration Template for Docker/Kubernetes
 *
 * This template file uses environment variable placeholders that can be substituted
 * at container startup using envsubst or similar tools.
 *
 * Usage with envsubst:
 *   envsubst < config.template.js > config.js
 *
 * Docker example:
 *   CMD envsubst < /app/dist/config.template.js > /app/dist/config.js && nginx -g 'daemon off;'
 *
 * Kubernetes ConfigMap example:
 *   apiVersion: v1
 *   kind: ConfigMap
 *   metadata:
 *     name: fiab-frontend-config
 *   data:
 *     config.js: |
 *       window.ENV_CONFIG = {
 *         API_BASE_URL: 'https://api.production.example.com',
 *         ENVIRONMENT: 'production',
 *         DEBUG: false,
 *       }
 */

window.ENV_CONFIG = {
  API_BASE_URL: '${API_BASE_URL:-null}',
  ENVIRONMENT: '${ENVIRONMENT:-production}',
  DEBUG: ${DEBUG:-false},
}
