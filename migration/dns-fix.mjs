// Side-effect import: lets mongodb+srv:// lookups work when Node is left with
// only loopback DNS resolvers (common on Windows with IPv6 link-local routers).
// See lib/mongodb.ts. Override with MONGODB_DNS_SERVERS (comma-separated).
import dns from 'node:dns';

const isLoopback = (s) => s === '::1' || s.startsWith('127.');
// The driver resolves SRV via dns.promises, which can hold its own resolver.
const useDnsServers = (servers) => {
  dns.setServers(servers);
  dns.promises.setServers(servers);
};
if (process.env.MONGODB_DNS_SERVERS) {
  useDnsServers(process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()));
} else if (dns.getServers().every(isLoopback) || dns.promises.getServers().every(isLoopback)) {
  useDnsServers(['8.8.8.8', '1.1.1.1']);
}
