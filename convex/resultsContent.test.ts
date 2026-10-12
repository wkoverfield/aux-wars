import { describe, expect, test, vi } from "vitest";

// Stand-in for the real word list, so no slur has to appear in a test.
vi.mock("./game/contentFilter", () => ({
  containsHateSpeech: (text: string) => text.toLowerCase().includes("blockme"),
}));

const { publicCover, publicText } = await import("./results");

describe("content cleaned on the way into a shared snapshot", () => {
  test("covers are kept only in the catalogs' thumbnail URL shapes, over https", () => {
    for (const ok of [
      "https://i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg",
      "https://i.ytimg.com/vi/tvTRZJ-4EyI/hq720.jpg",
      "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/aa/bb/cc/aabbcc-1234/cover.jpg/300x300bb.jpg",
      "https://e-cdns-images.dzcdn.net/images/cover/0123456789abcdef/250x250-000000-80-0-0.jpg",
      "https://cdn-images.dzcdn.net/images/cover/0123456789abcdef/250x250.jpg",
    ]) {
      expect(publicCover(ok)).toBe(ok);
    }
    for (const bad of [
      "https://evil.example/pixel.gif",
      "http://i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg",
      "https://i.ytimg.com.evil.example/vi/tvTRZJ-4EyI/mqdefault.jpg",
      "https://evil.example/i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg",
      "https://user:pass@i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg",
      "https://i.ytimg.com:8443/vi/tvTRZJ-4EyI/mqdefault.jpg",
      // Right host, wrong shape: not a thumbnail path.
      "https://i.ytimg.com/an_webp/tvTRZJ-4EyI/mqdefault_6s.webp",
      "https://i.ytimg.com/vi/short/mqdefault.jpg",
      "https://i.ytimg.com/vi/tvTRZJ-4EyI/../../other.jpg",
      "https://i.ytimg.com/generate_204",
      "https://is1-ssl.mzstatic.com/other/path.jpg",
      "https://cdn-images.dzcdn.net/images/misc/abc/250x250.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "",
      "not a url",
      `https://i.ytimg.com/vi/tvTRZJ-4EyI/${"a".repeat(600)}.jpg`,
    ]) {
      expect(publicCover(bad)).toBe("");
    }
    // Query strings and fragments are never carried onto a public page.
    expect(publicCover("https://i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg?sqp=track-me")).toBe("");
    expect(publicCover("https://i.ytimg.com/vi/tvTRZJ-4EyI/mqdefault.jpg#x")).toBe("");
  });

  test("text is bounded, cut on whole characters, collapsed and filtered", () => {
    expect(publicText("  Money   Trees \n")).toBe("Money Trees");
    expect(publicText("x".repeat(500))).toHaveLength(120);
    expect(publicText("x".repeat(500), 200)).toHaveLength(200);
    expect(publicText("a perfectly fine title")).toBe("a perfectly fine title");
    expect(publicText("some BlockMe title")).toBe("[removed]");

    // An emoji sitting on the cut is kept whole or dropped, never halved.
    const emoji = publicText("😀".repeat(200));
    expect(Array.from(emoji)).toHaveLength(120);
    expect(emoji).toBe("😀".repeat(120));
    expect(publicText(`${"a".repeat(119)}😀b`)).toBe(`${"a".repeat(119)}😀`);
    // Lone surrogates and control characters are removed.
    expect(publicText("ab\uD83Dcd\u0000ef\uDE00")).toBe("abcdef");
    // A very large input is bounded before any pattern runs over it.
    const started = Date.now();
    expect(publicText(" ".repeat(2_000_000) + "tail")).toBe("");
    expect(publicText("y".repeat(2_000_000))).toHaveLength(120);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
