import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import InviteSheet from "./InviteSheet";

afterEach(cleanup);

describe("InviteSheet", () => {
  it("shows only the options it is given, share first", () => {
    render(<InviteSheet onClose={() => {}} onShare={() => {}} onCopyLink={() => {}} onShowQr={() => {}} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels[0]).toContain("Share invite link");
    expect(labels.some((l) => l.includes("Play on a TV"))).toBe(false);
    cleanup();
    render(<InviteSheet onClose={() => {}} onCopyLink={() => {}} />);
    expect(screen.queryByText("Share invite link")).toBeNull();
    expect(screen.queryByText("Show QR code")).toBeNull();
    expect(screen.getByText("Copy invite link")).toBeTruthy();
  });

  it("closes and runs the chosen option", () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    render(<InviteSheet onClose={onClose} onCopyLink={() => {}} onShowQr={onShowQr} />);
    fireEvent.click(screen.getByText("Show QR code"));
    expect(onClose).toHaveBeenCalled();
    expect(onShowQr).toHaveBeenCalled();
  });

  it("closes on Escape, the backdrop, and Cancel", () => {
    const onClose = vi.fn();
    render(<InviteSheet onClose={onClose} onCopyLink={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
