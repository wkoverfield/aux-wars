import { expect, test } from "vitest";
import { CURATED_PROMPTS, PROMPT_PACKS } from "./game/promptPacks";
import { promptCategories, getAllPrompts } from "../client/src/data/promptCategories.js";

// The server copy seeds Quick Play rooms; the client copy drives the private
// room pack picker. They must stay identical.
test("server prompt packs equal the client prompt categories", () => {
  expect(PROMPT_PACKS).toEqual(promptCategories);
});

test("curated prompts are every pack prompt, in order, with no duplicates", () => {
  expect(CURATED_PROMPTS).toEqual(getAllPrompts());
  expect(new Set(CURATED_PROMPTS).size).toBe(CURATED_PROMPTS.length);
});
