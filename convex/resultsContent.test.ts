import { describe, expect, test, vi } from "vitest";

// Stand-in for the real word list, so no slur has to appear in a test.
vi.mock("./game/contentFilter", () => ({
  containsHateSpeech: (text: string) => text.toLowerCase().includes("blockme"),
}));

const { publicCover, publicText } = await import("./results");

describe("content cleaned on the way into a shared snapshot", () => {
  test("covers are kept only from the catalogs' image hosts, over https", () => {
    for (const ok of [
      "https://i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg",
      "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/a/b/c/300x300bb.jpg",
      "https://e-cdns-images.dzcdn.net/images/cover/abc/250x250-000000-80-0-0.jpg",
      "https://cdn-images.dzcdn.net/images/cover/abc/250x250.jpg",
    ]) {
      expect(publicCover(ok)).toBe(ok);
    }
    for (const bad of [
      "https://evil.example/pixel.gif",
      "http://i.ytimg.com/vi/x/mqdefault.jpg",
      "https://i.ytimg.com.evil.example/vi/x/mqdefault.jpg",
      "https://evil.example/i.ytimg.com/vi/x.jpg",
      "https://user:pass@i.ytimg.com/vi/x/mqdefault.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "",
      "not a url",
    ]) {
      expect(publicCover(bad)).toBe("");
    }
  });

  test("text is collapsed, capped and filtered", () => {
    expect(publicText("  Money   Trees \n")).toBe("Money Trees");
    expect(publicText("x".repeat(500))).toHaveLength(120);
    expect(publicText("x".repeat(500), 200)).toHaveLength(200);
    expect(publicText("a perfectly fine title")).toBe("a perfectly fine title");
    expect(publicText("some BlockMe title")).toBe("[removed]");
  });
});
