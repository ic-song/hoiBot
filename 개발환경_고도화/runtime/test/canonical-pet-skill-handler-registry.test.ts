import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { normalizeCanonicalPetSkillOptions, resolveCanonicalPetSkillHandler } from "../src/pet/canonical-pet-skill-handler-registry.js";

describe("canonical pet skill handler registry", () => {
  it("validates every synthetic definition through the code registry", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/canonical-pet-skill-v1.json", import.meta.url), "utf8")) as { definitions: Array<{ handlerKey: string; options: unknown }> };
    for (const definition of fixture.definitions) assert.doesNotThrow(() => normalizeCanonicalPetSkillOptions(definition.handlerKey, definition.options));
  });

  it("accepts only allowlisted handler keys and typed options", () => {
    assert.deepEqual(normalizeCanonicalPetSkillOptions("passive_modifier", { raidCharm: 1000000, castleCharm: 1000000 }), { raidCharm: 1000000, castleCharm: 1000000 });
    assert.deepEqual(normalizeCanonicalPetSkillOptions("command_unlock", { commandName: "/자랑", chancePercent: 70 }), { commandName: "/자랑", chancePercent: 70 });
    assert.deepEqual(normalizeCanonicalPetSkillOptions("presentation_only", {}), {});
    assert.throws(() => resolveCanonicalPetSkillHandler("eval_script"), /HANDLER_NOT_ALLOWED/);
  });

  it("rejects executable or unknown option fields and invalid values", () => {
    assert.throws(() => normalizeCanonicalPetSkillOptions("command_unlock", { commandName: "/결투", javascript: "doWork()" }), /OPTION_KEY_NOT_ALLOWED/);
    assert.throws(() => normalizeCanonicalPetSkillOptions("passive_modifier", { chancePercent: 101 }), /CHANCE_INVALID/);
    assert.throws(() => normalizeCanonicalPetSkillOptions("passive_modifier", {}), /PASSIVE_OPTIONS_REQUIRED/);
  });
});
