// Storage endpoint validation. The endpoint on a connection row is a
// destination the SERVER dials with the operator's or the caller's credentials,
// which makes it an authorization decision and not just a data field: a caller
// who can point a project at an arbitrary host turns the backend into a request
// relay into whatever that host can reach (loopback services, internal networks,
// the cloud metadata address).
//
// Two layers, because they answer different questions:
//   - syntax: is this an absolute http(s) URL without embedded credentials?
//   - destination: is the resolved address somewhere a non-admin caller may
//     point the server? An admin owns the deployment and may reach private
//     storage (the compose stack talks to MinIO over an internal name), so the
//     address restriction applies to non-admin callers only.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type EndpointProblem = string | null;

export function validateStorageEndpointSyntax(value: string): EndpointProblem {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Endpoint must be an absolute URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Endpoint must use http or https";
  if (url.username || url.password) return "Endpoint must not carry credentials";
  return null;
}

// Not globally routable: loopback, private, link-local (which includes the cloud
// metadata addresses), unique-local, carrier-grade NAT, shared, multicast,
// reserved or unspecified, in either family.
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("ff")) return true;
    // IPv4-mapped (::ffff:a.b.c.d) is judged by the IPv4 rules.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  // Not an IP literal at all: treat as unusable rather than as public.
  return true;
}

// Full check. Returns null when the endpoint is acceptable, otherwise the reason.
export async function validateStorageEndpoint(
  value: string,
  options: { allowPrivate: boolean }
): Promise<EndpointProblem> {
  const syntax = validateStorageEndpointSyntax(value);
  if (syntax) return syntax;
  if (options.allowPrivate) return null;

  const url = new URL(value);
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isIP(host)) {
    return isPrivateAddress(host) ? "Endpoint must be a public destination" : null;
  }
  // A name can resolve to an internal address, so it is resolved here rather
  // than trusted. This does not bind the address the request will use later: a
  // name can be re-pointed after the check, which is why the admin path is the
  // place for endpoints that legitimately live on a private network.
  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    return "Endpoint host could not be resolved";
  }
  if (addresses.length === 0) return "Endpoint host could not be resolved";
  return addresses.some(isPrivateAddress) ? "Endpoint must be a public destination" : null;
}
