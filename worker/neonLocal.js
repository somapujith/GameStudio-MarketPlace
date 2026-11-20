// Lets the Neon HTTP driver reach the local staging database (docker-compose.yml). Neon's driver
// normally sends queries to https://api.<host>/sql; for a localhost connection string it is sent
// to the local-neon-http-proxy container instead. Every other host keeps the default endpoint, so
// production is unaffected.
import { neonConfig } from '@neondatabase/serverless';

export const LOCAL_PROXY_PORT = 4444;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'db.localtest.me']);

export const isLocalHost = (host) => LOCAL_HOSTS.has(String(host || '').toLowerCase());

const defaultEndpoint = neonConfig.fetchEndpoint;

neonConfig.fetchEndpoint = (host, port, opts) =>
  isLocalHost(host) ? `http://${host}:${LOCAL_PROXY_PORT}/sql` : defaultEndpoint(host, port, opts);
