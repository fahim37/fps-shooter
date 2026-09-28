import { expect, it } from "vitest";
import { inviteUrl, parseRoomCode } from "./invite";

it("accepts codes and invites without losing the deployed base path", () => {
  expect(parseRoomCode(" ab2cd ")).toBe("AB2CD");
  const url = inviteUrl("AB2CD", "https://fahimstack.tech/fps?other=value#old");
  expect(url).toBe("https://fahimstack.tech/fps?room=AB2CD");
  expect(parseRoomCode(url)).toBe("AB2CD");
  expect(parseRoomCode("https://example.com/no-room")).toBe("");
  expect(parseRoomCode("bad")).toBe("");
});
