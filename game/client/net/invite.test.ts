import { expect, it } from "vitest";
import { inviteUrl, lobbyUrl, parseRoomCode } from "./invite";

it("makes short invites and reads both kinds back", () => {
  expect(parseRoomCode(" ab2cd ")).toBe("AB2CD");
  const url = inviteUrl("AB2CD", "https://fps.famstack.cloud/?other=value#old");
  expect(url).toBe("https://fps.famstack.cloud/AB2CD");
  expect(parseRoomCode(url)).toBe("AB2CD");
  expect(inviteUrl("XY3ZW", "https://fps.famstack.cloud/AB2CD")).toBe("https://fps.famstack.cloud/XY3ZW");
  expect(parseRoomCode("https://fps.famstack.cloud/bph2u")).toBe("BPH2U");
  // Invites sent before the short form keep working.
  expect(parseRoomCode("https://fps.famstack.cloud/?room=BPH2U")).toBe("BPH2U");
  expect(lobbyUrl("https://fps.famstack.cloud/BPH2U?x=1")).toBe("https://fps.famstack.cloud/");
  expect(parseRoomCode("https://fps.famstack.cloud/admin")).toBe("");
  expect(parseRoomCode("https://example.com/no-room")).toBe("");
  expect(parseRoomCode("https://example.com/a/AB2CD")).toBe("");
  expect(parseRoomCode("bad")).toBe("");
});
