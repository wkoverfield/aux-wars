import { describe, expect, test } from "vitest";
import { fallBackToOriginal, largeCoverArt } from "./coverArt";

describe("largeCoverArt", () => {
  test("upgrades YouTube thumbnails to hq720", () => {
    expect(largeCoverArt("https://i.ytimg.com/vi/abc123/mqdefault.jpg")).toBe("https://i.ytimg.com/vi/abc123/hq720.jpg");
    expect(largeCoverArt("https://i.ytimg.com/vi/abc123/hqdefault.jpg?sqp=xyz")).toBe("https://i.ytimg.com/vi/abc123/hq720.jpg");
  });
  test("leaves other art alone", () => {
    const itunes = "https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg";
    expect(largeCoverArt(itunes)).toBe(itunes);
    expect(largeCoverArt(undefined)).toBe(undefined);
  });
});

describe("fallBackToOriginal", () => {
  test("swaps to the original once", () => {
    const img = { src: "https://i.ytimg.com/vi/a/hq720.jpg" };
    fallBackToOriginal("https://i.ytimg.com/vi/a/mqdefault.jpg")({ currentTarget: img });
    expect(img.src).toBe("https://i.ytimg.com/vi/a/mqdefault.jpg");
    fallBackToOriginal("https://i.ytimg.com/vi/a/mqdefault.jpg")({ currentTarget: img });
    expect(img.src).toBe("https://i.ytimg.com/vi/a/mqdefault.jpg");
  });
});
