// Paired test for modules/storage/endpoint.ts: the destination rules that keep a
// non-admin caller from pointing the backend at a host it should not dial.
import { describe, expect, it } from "bun:test";
import { isPrivateAddress, validateStorageEndpoint, validateStorageEndpointSyntax } from "@/modules/storage/endpoint";

describe("validateStorageEndpointSyntax", () => {
  it("accepts an absolute http or https URL", () => {
    expect(validateStorageEndpointSyntax("https://fsn1.your-objectstorage.com")).toBeNull();
    expect(validateStorageEndpointSyntax("http://127.0.0.1:9000")).toBeNull();
  });

  it("rejects anything that is not an absolute http(s) URL", () => {
    expect(validateStorageEndpointSyntax("not-a-url")).not.toBeNull();
    expect(validateStorageEndpointSyntax("file:///etc/passwd")).not.toBeNull();
    expect(validateStorageEndpointSyntax("ftp://example.com")).not.toBeNull();
  });

  it("rejects credentials embedded in the URL", () => {
    expect(validateStorageEndpointSyntax("https://user:pass@example.com")).not.toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local and reserved ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.9.9",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fd00:ec2::254",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.1.2.3",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it("does not flag globally routable addresses", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});

describe("validateStorageEndpoint", () => {
  it("accepts a public literal for a non-admin caller", async () => {
    expect(await validateStorageEndpoint("https://93.184.216.34", { allowPrivate: false })).toBeNull();
  });

  it("refuses private and metadata destinations for a non-admin caller", async () => {
    for (const endpoint of [
      "http://127.0.0.1:9000",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5:8080/admin",
      "http://[fd00:ec2::254]/latest/meta-data/",
      "http://192.168.1.10:9000",
    ]) {
      expect(await validateStorageEndpoint(endpoint, { allowPrivate: false })).toBe(
        "Endpoint must be a public destination"
      );
    }
  });

  it("lets an admin reach private storage", async () => {
    // The compose stack talks to MinIO over a private address, so this is the
    // path a self-hoster needs.
    expect(await validateStorageEndpoint("http://127.0.0.1:9000", { allowPrivate: true })).toBeNull();
    expect(await validateStorageEndpoint("http://169.254.169.254", { allowPrivate: true })).toBeNull();
  });

  it("still applies the syntax rules to an admin", async () => {
    expect(await validateStorageEndpoint("file:///etc/passwd", { allowPrivate: true })).not.toBeNull();
    expect(await validateStorageEndpoint("not-a-url", { allowPrivate: true })).not.toBeNull();
  });

  it("refuses a hostname that cannot be resolved", async () => {
    // .invalid never resolves, so this covers the resolution failure path
    // without depending on a real name.
    expect(await validateStorageEndpoint("https://sigit-endpoint.invalid", { allowPrivate: false })).toBe(
      "Endpoint host could not be resolved"
    );
  });
});
