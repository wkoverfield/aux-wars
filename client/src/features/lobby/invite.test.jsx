import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { INVITE_TEXT, INVITE_TITLE, copyInvite, inviteUrl, isTouchDevice, sendInvite } from "./invite";

const toDataURL = vi.fn();
vi.mock("qrcode", () => ({ toDataURL: (...args) => toDataURL(...args) }));
const { default: InviteQrModal } = await import("./InviteQrModal");

const URL_ = "https://www.aux-wars.com/lobby/ABC123";

describe("inviteUrl", () => {
  it("points at the room's join screen", () => {
    expect(inviteUrl("ABC123", "https://www.aux-wars.com")).toBe(URL_);
  });
});

describe("sendInvite", () => {
  it("uses the share sheet on a touch device that has one", async () => {
    const nav = { share: vi.fn(async () => {}), clipboard: { writeText: vi.fn() } };
    expect(await sendInvite(URL_, nav, true)).toBe("shared");
    expect(nav.share).toHaveBeenCalledWith({ title: INVITE_TITLE, text: INVITE_TEXT, url: URL_ });
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("treats a dismissed share sheet as cancelled and copies nothing", async () => {
    const nav = {
      share: vi.fn(async () => { throw new DOMException("dismissed", "AbortError"); }),
      clipboard: { writeText: vi.fn() },
    };
    expect(await sendInvite(URL_, nav, true)).toBe("cancelled");
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies on desktop even though desktop browsers expose navigator.share", async () => {
    const nav = { share: vi.fn(async () => {}), clipboard: { writeText: vi.fn(async () => {}) } };
    expect(await sendInvite(URL_, nav, false)).toBe("copied");
    expect(nav.share).not.toHaveBeenCalled();
    expect(isTouchDevice({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isTouchDevice({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isTouchDevice({})).toBe(false);
  });

  it("copies when there is no share sheet, or when sharing is blocked", async () => {
    const plain = { clipboard: { writeText: vi.fn(async () => {}) } };
    expect(await sendInvite(URL_, plain, true)).toBe("copied");
    expect(plain.clipboard.writeText).toHaveBeenCalledWith(URL_);

    const blocked = {
      share: vi.fn(async () => { throw new DOMException("not allowed", "NotAllowedError"); }),
      clipboard: { writeText: vi.fn(async () => {}) },
    };
    expect(await sendInvite(URL_, blocked, true)).toBe("copied");
  });

  it("reports failure when neither works", async () => {
    expect(await sendInvite(URL_, { clipboard: { writeText: async () => { throw new Error("denied"); } } })).toBe("failed");
    expect(await sendInvite(URL_, {})).toBe("failed");
    expect(await copyInvite(URL_, undefined)).toBe(false);
  });

  it("has no em dash in the message", () => {
    expect(INVITE_TEXT).not.toMatch(/—/);
  });
});

describe("InviteQrModal", () => {
  afterEach(() => {
    cleanup();
    toDataURL.mockReset();
  });

  it("encodes the invite link and shows the code", async () => {
    toDataURL.mockResolvedValue("data:image/png;base64,QUJD");
    render(<InviteQrModal url={URL_} onClose={() => {}} />);
    expect(screen.getByRole("status")).toBeTruthy();
    const img = await screen.findByAltText("QR code for this game's invite link");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,QUJD");
    expect(toDataURL.mock.calls[0][0]).toBe(URL_);
  });

  it("says so when the code cannot be made", async () => {
    toDataURL.mockRejectedValue(new Error("nope"));
    render(<InviteQrModal url={URL_} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Couldn't make the code/)).toBeTruthy());
  });

  it("closes on Done, Escape and a backdrop click, not on a click inside", () => {
    toDataURL.mockResolvedValue("data:image/png;base64,QUJD");
    const onClose = vi.fn();
    render(<InviteQrModal url={URL_} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
