import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import AlbumsDisplay from "./AlbumsDisplay";
import AnimatedLogo from "./AnimatedLogo";

describe("album wall", () => {
  afterEach(cleanup);

  it("animates rows with CSS classes, alternating direction", () => {
    const albums = Array.from({ length: 18 }, (_, i) => `/a${i}.webp`);
    const { container } = render(<AlbumsDisplay albums={albums} />);
    const rows = container.querySelectorAll(".album-row-track");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-direction")).toBe("left");
    expect(rows[1].getAttribute("data-direction")).toBe("right");
    // No inline transform from a JS animation driver.
    rows.forEach((row) => expect(row.getAttribute("style")).toBeNull());
  });

  it("pulses the logo with a CSS class", () => {
    const { getByTestId } = render(<AnimatedLogo />);
    expect(getByTestId("animated-logo").className).toContain("logo-pulse");
  });
});
