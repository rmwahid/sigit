import { describe, expect, it } from "bun:test";
import {
  classifyAction,
  scopeAllows,
  scopeForAction,
  scopeForLfsOperation,
} from "@/modules/auth/scopes";

describe("classifyAction", () => {
  it("classifies git paths", () => {
    expect(classifyAction("GET", "/projects/x.git/info/refs")).toBe("clone");
    expect(classifyAction("POST", "/projects/x.git/git-upload-pack")).toBe("clone");
    expect(classifyAction("POST", "/projects/x.git/git-receive-pack")).toBe("push");
  });

  it("classifies lfs paths", () => {
    expect(classifyAction("POST", "/projects/x.git/info/lfs/objects/batch")).toBe("lfsBatch");
    expect(classifyAction("PUT", "/projects/x.git/info/lfs/objects/abc")).toBe("lfsUpload");
    expect(classifyAction("GET", "/projects/x.git/info/lfs/objects/abc")).toBe("lfsDownload");
    expect(classifyAction("POST", "/projects/x.git/info/lfs/objects/abc/verify")).toBe("lfsDownload");
  });
});

describe("scopeForAction", () => {
  it("maps actions to minimum scope", () => {
    expect(scopeForAction("push")).toBe("write");
    expect(scopeForAction("lfsUpload")).toBe("write");
    expect(scopeForAction("clone")).toBe("read");
    expect(scopeForAction("lfsDownload")).toBe("read");
    expect(scopeForAction("lfsBatch")).toBe("read");
  });
});

describe("scopeForLfsOperation", () => {
  it("requires write for upload and read for download", () => {
    expect(scopeForLfsOperation("upload")).toBe("write");
    expect(scopeForLfsOperation("download")).toBe("read");
  });
});

describe("scopeAllows", () => {
  it("write implies read", () => {
    expect(scopeAllows("write", "write")).toBe(true);
    expect(scopeAllows("write", "read")).toBe(true);
  });

  it("read only allows read", () => {
    expect(scopeAllows("read", "read")).toBe(true);
    expect(scopeAllows("read", "write")).toBe(false);
  });
});
