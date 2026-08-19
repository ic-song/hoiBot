import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptHoiBotVersionCommand,
  CURRENT_HOIBOT_VERSION,
  StaticHoiBotVersionProvider
} from "../src/hoibot-version.js";

describe("/호이봇버전 in-memory probe", () => {
  it("VERSION-001: exact command returns the current legacy-parity reply", () => {
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전"), "ver_2.393");
  });

  it("VERSION-002: suffix and whitespace inputs do not enter the exact adapter", () => {
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전 1"), undefined);
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전 "), undefined);
  });

  it("VERSION-003: the provider exposes the pinned source and preserves the missing-value concatenation boundary", () => {
    assert.equal(new StaticHoiBotVersionProvider().getVersion(), CURRENT_HOIBOT_VERSION);
    assert.equal(CURRENT_HOIBOT_VERSION, "2.393");
    const missingProvider = { getVersion: () => undefined as unknown as string };
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전", missingProvider), "ver_undefined");
  });

  it("VERSION-004: the adapter has no sender or consent-dependent branch", () => {
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전"), "ver_2.393");
  });

  it("VERSION-005: repeated reads have no accumulated state", () => {
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전"), "ver_2.393");
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전"), "ver_2.393");
  });

  it("VERSION-006: a fresh provider has the same static value", () => {
    assert.equal(adaptHoiBotVersionCommand("/호이봇버전", new StaticHoiBotVersionProvider()), "ver_2.393");
  });
});
