import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_FILE = "src/app.ts";
const PET_EXPLORE_INGRESS_FILE = "src/pet/pet-explore-app-wiring-ingress.ts";
const PET_EXPLORE_EVENT_CONTROL_PROVIDER_FILE = "src/pet/pet-explore-event-control-app-wiring-provider.ts";
const APP_WIRING_OPERATION_PROVIDER_FILE = "src/dispatch/app-wiring-operation-provider.ts";
const PET_EXPLORE_EVENT_CONTROL_MIGRATION_FILE = "migrations/470_pet_explore_event_control_app_wiring.sql";
const PET_EXPLORE_EVENT_CONTROL_ROLLBACK_FILE = "migrations/rollback/470_pet_explore_event_control_app_wiring.rollback.sql";
const PET_DATA_COMPARE_INGRESS_FILE = "src/admin/pet-data-compare-app-wiring-ingress.ts";
const PET_DATA_COMPARE_SHADOW_EVALUATOR_FILE = "src/admin/pet-data-compare-shadow-snapshot-provider.ts";
const PET_TITLE_INGRESS_FILE = "src/pet/pet-title-app-wiring-ingress.ts";
const PET_TITLE_MUTATION_PROVIDER_FILE = "src/pet/pet-title-canonical-mutation-provider.ts";
const RUNNER_NAME = "executeAppWiringEntrypoint";
const WRAPPER_NAMES = ["dispatchPetExploreSettlementCommand", "dispatchPetExploreEventControlCommand"] as const;

export interface ObjectDbRuntimeAdoptionSources {
  readonly appSource: string;
  readonly petExploreIngressSource: string;
  readonly petExploreEventControlProviderSource: string;
  readonly appWiringOperationProviderSource: string;
  readonly petExploreEventControlMigrationSource: string;
  readonly petExploreEventControlRollbackSource: string;
  readonly petDataCompareIngressSource: string;
  readonly petDataCompareShadowEvaluatorSource: string;
  readonly petTitleIngressSource: string;
  readonly petTitleMutationProviderSource: string;
}

export interface ObjectDbRuntimeAdoptionExpectedHashes {
  readonly appSourceSha256: string;
  readonly petExploreIngressSourceSha256: string;
  readonly petExploreEventControlProviderSourceSha256?: string;
  readonly appWiringOperationProviderSourceSha256?: string;
  readonly petExploreEventControlMigrationSourceSha256?: string;
  readonly petExploreEventControlRollbackSourceSha256?: string;
  // Optional at the type boundary for old persisted contracts; omission still fails closed below.
  readonly petDataCompareIngressSourceSha256?: string;
  readonly petDataCompareShadowEvaluatorSourceSha256?: string;
  readonly petTitleIngressSourceSha256?: string;
  readonly petTitleMutationProviderSourceSha256?: string;
}

export type ObjectDbRuntimeAdoptionCallSite = {
  readonly sourceFile: string;
  readonly functionName: "PetExploreAppWiringIngress.handle" | "PetDataCompareAppWiringIngress.handle" | "PetTitleAppWiringIngress.handle";
  readonly entrypointKind: "IRIS";
  readonly domain: "PET_EXPLORE" | "ADMIN_PET_DATA_COMPARE" | "PET_TITLE";
  readonly effectModes: readonly ("MODERN_MUTATION" | "SHADOW" | "REJECT")[];
};

export interface ObjectDbRuntimeAdoptionAuditResult {
  readonly compliant: boolean;
  readonly productionSourceCallCount: number;
  readonly callSites: readonly ObjectDbRuntimeAdoptionCallSite[];
  readonly connectedIngressFamilies: readonly string[];
  readonly failures: readonly string[];
}

interface SourceSpan { readonly start: number; readonly end: number; readonly source: string; readonly code: string }

function canonicalLf(value: string): string { return value.replace(/\r\n?/g, "\n"); }
function sha256(value: string): string { return createHash("sha256").update(canonicalLf(value), "utf8").digest("hex"); }

function regexMayStart(source: string, before: number): boolean {
  let index = before - 1;
  while (index >= 0 && /\s/.test(source[index]!)) index -= 1;
  if (index < 0 || /[=(,:!?&|;{}\[<>]/.test(source[index]!)) return true;
  if (!/[A-Za-z0-9_$]/.test(source[index]!)) return false;
  const end = index + 1;
  while (index >= 0 && /[A-Za-z0-9_$]/.test(source[index]!)) index -= 1;
  return /^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(source.slice(index + 1, end));
}

// Preserve offsets while blanking comments, literals and regex bodies, so inert text cannot become evidence.
function lexicalMask(source: string, semanticStrings: boolean): string {
  const output = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" | "regex" = "code";
  let escaped = false;
  let regexCharacterClass = false;
  let literalStart = -1;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
    if (state === "code") {
      if (current === "/" && next === "/") { output[index] = output[index + 1] = " "; state = "line"; index += 1; continue; }
      if (current === "/" && next === "*") { output[index] = output[index + 1] = " "; state = "block"; index += 1; continue; }
      if (current === "'") { output[index] = semanticStrings ? current : " "; literalStart = index; state = "single"; continue; }
      if (current === '"') { output[index] = semanticStrings ? current : " "; literalStart = index; state = "double"; continue; }
      if (current === "`") { output[index] = " "; state = "template"; continue; }
      if (current === "/" && regexMayStart(source, index)) { output[index] = " "; regexCharacterClass = false; state = "regex"; continue; }
      continue;
    }
    if (current !== "\n") output[index] = " ";
    if (state === "line") { if (current === "\n") state = "code"; continue; }
    if (state === "block") {
      if (current === "*" && next === "/") { output[index + 1] = " "; state = "code"; index += 1; }
      continue;
    }
    if (escaped) { escaped = false; continue; }
    if (current === "\\") { escaped = true; continue; }
    if ((state === "single" && current === "'") || (state === "double" && current === '"')) {
      if (semanticStrings) {
        const value = source.slice(literalStart + 1, index);
        const marker = value === "LEGACY_FALLBACK" ? "L" : value === "MODERN" ? "M" : value === "IRIS" ? "I"
          : value === "READ_ONLY" ? "D" : value === "incoming" ? "G" : value === "trusted" ? "T"
            : value === "EVENT_CONTROL" ? "E" : value === "SETTLEMENT" ? "S"
              : value === "claimed" ? "C"
            : value === "legacy_fallback" ? "F" : value === "not_applicable" ? "N"
              : value === "pet_explore_app_wiring" ? "P"
            : value === "pet_data_compare_app_wiring" ? "A" : /\/app-wiring-entrypoint-runner\.js$/.test(value) ? "R" : "_";
        for (let position = literalStart + 1; position < index; position += 1) output[position] = marker;
        output[index] = current;
      }
      state = "code";
    } else if (state === "template" && current === "`") state = "code";
    else if (state === "regex") {
      if (current === "[") regexCharacterClass = true;
      else if (current === "]") regexCharacterClass = false;
      else if (current === "/" && !regexCharacterClass) state = "code";
    }
  }
  return output.join("");
}

function codeMask(source: string): string { return lexicalMask(source, false); }
function semanticMask(source: string): string { return lexicalMask(source, true); }

function encodedToken(kind: "S" | "T" | "R", value: string): string {
  const units: string[] = [];
  for (let index = 0; index < value.length; index += 1) units.push(value.charCodeAt(index).toString(16).padStart(4, "0"));
  return `@${kind}[${units.join(":")}]`;
}

// Body contracts need literal values, unlike call discovery. Encode inert text so values remain exact without becoming code evidence.
function canonicalSemanticTokens(source: string): string {
  let output = "";
  for (let index = 0; index < source.length;) {
    const current = source[index]!;
    const next = source[index + 1];
    if (/\s/.test(current)) { index += 1; continue; }
    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      let value = "";
      index += 1;
      let escaped = false;
      while (index < source.length) {
        const character = source[index]!;
        if (!escaped && character === quote) { index += 1; break; }
        value += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        index += 1;
      }
      output += encodedToken(quote === "`" ? "T" : "S", value);
      continue;
    }
    if (current === "/" && regexMayStart(source, index)) {
      let value = "";
      let escaped = false;
      let characterClass = false;
      index += 1;
      while (index < source.length) {
        const character = source[index]!;
        if (!escaped && character === "[") characterClass = true;
        else if (!escaped && character === "]") characterClass = false;
        else if (!escaped && character === "/" && !characterClass) { index += 1; break; }
        value += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        index += 1;
      }
      while (index < source.length && /[A-Za-z]/.test(source[index]!)) { value += source[index]!; index += 1; }
      output += encodedToken("R", value);
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

function balancedBodyEnd(code: string, openBrace: number): number | undefined {
  let depth = 0;
  for (let index = openBrace; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}" && --depth === 0) return index + 1;
  }
  return undefined;
}

function balancedDelimiterEnd(code: string, open: number, opening: string, closing: string): number | undefined {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === opening) depth += 1;
    if (code[index] === closing && --depth === 0) return index + 1;
  }
  return undefined;
}

function spanFromMatch(source: string, code: string, matchIndex: number, matchLength: number): SourceSpan | undefined {
  const openBrace = code.indexOf("{", matchIndex + matchLength);
  if (openBrace < 0) return undefined;
  const end = balancedBodyEnd(code, openBrace);
  return end === undefined ? undefined : { start: matchIndex, end, source: source.slice(matchIndex, end), code: code.slice(matchIndex, end) };
}

function namedFunction(source: string, name: string): SourceSpan | undefined {
  const code = codeMask(source);
  const matches = [...code.matchAll(new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, "g"))];
  if (matches.length !== 1 || matches[0]?.index === undefined) return undefined;
  const parameterOpen = code.indexOf("(", matches[0].index);
  const parameterEnd = balancedDelimiterEnd(code, parameterOpen, "(", ")");
  if (parameterEnd === undefined) return undefined;
  return spanFromMatch(source, code, matches[0].index, parameterEnd - matches[0].index);
}

function namedClassMethod(source: string, className: string, methodName: string): SourceSpan | undefined {
  const code = codeMask(source);
  const classes = [...code.matchAll(new RegExp(`\\bclass\\s+${className}\\b`, "g"))];
  if (classes.length !== 1 || classes[0]?.index === undefined) return undefined;
  const classSpan = spanFromMatch(source, code, classes[0].index, classes[0][0].length);
  if (classSpan === undefined) return undefined;
  const methods = [...classSpan.code.matchAll(new RegExp(`\\b(?:async\\s+)?${methodName}\\s*\\(`, "g"))];
  if (methods.length !== 1 || methods[0]?.index === undefined) return undefined;
  const parameterOpen = classSpan.code.indexOf("(", methods[0].index);
  const parameterEnd = balancedDelimiterEnd(classSpan.code, parameterOpen, "(", ")");
  if (parameterEnd === undefined) return undefined;
  const local = spanFromMatch(classSpan.source, classSpan.code, methods[0].index, parameterEnd - methods[0].index);
  return local === undefined ? undefined : { ...local, start: classSpan.start + local.start, end: classSpan.start + local.end };
}

function functionParameterNames(span: SourceSpan | undefined): string[] | undefined {
  if (span === undefined) return undefined;
  const open = span.code.indexOf("(");
  const end = balancedDelimiterEnd(span.code, open, "(", ")");
  if (open < 0 || end === undefined) return undefined;
  const parameters: string[] = [];
  let start = open + 1;
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;
  let angles = 0;
  const append = (finish: number): void => {
    const segment = span.code.slice(start, finish).trim();
    if (segment.length === 0) return;
    const match = /^(?:\.\.\.\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\b/.exec(segment);
    parameters.push(match?.[1] ?? "<invalid>");
  };
  for (let index = start; index < end - 1; index += 1) {
    const current = span.code[index]!;
    if (current === "(") parentheses += 1;
    else if (current === ")") parentheses -= 1;
    else if (current === "{") braces += 1;
    else if (current === "}") braces -= 1;
    else if (current === "[") brackets += 1;
    else if (current === "]") brackets -= 1;
    else if (current === "<") angles += 1;
    else if (current === ">" && angles > 0) angles -= 1;
    else if (current === "," && parentheses === 0 && braces === 0 && brackets === 0 && angles === 0) { append(index); start = index + 1; }
  }
  append(end - 1);
  return parameters;
}

function canonicalFunctionBody(span: SourceSpan | undefined): string | undefined {
  if (span === undefined) return undefined;
  const structural = codeMask(span.source);
  const parameterOpen = structural.indexOf("(");
  const parameterEnd = balancedDelimiterEnd(structural, parameterOpen, "(", ")");
  if (parameterOpen < 0 || parameterEnd === undefined) return undefined;
  const bodyOpen = structural.indexOf("{", parameterEnd);
  const bodyEnd = bodyOpen < 0 ? undefined : balancedBodyEnd(structural, bodyOpen);
  if (bodyEnd === undefined) return undefined;
  return canonicalSemanticTokens(span.source.slice(bodyOpen + 1, bodyEnd - 1));
}

function canonicalExpectedBody(source: string): string {
  return canonicalSemanticTokens(source);
}

const DISPATCH_BODY = canonicalExpectedBody(`
  await dispatchPetExploreSettlementCommand(ingress,isOperationalChannel,duplicate,event);
  await dispatchPetExploreEventControlCommand(ingress,isOperationalChannel,duplicate,event);
`);
const SETTLEMENT_WRAPPER_BODY = canonicalExpectedBody(`
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetExploreSettlementCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return;
  await ingress.handle(event);
`);
const EVENT_CONTROL_WRAPPER_BODY = canonicalExpectedBody(`
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetExploreEventControlCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return;
  await ingress.handle(event);
`);
const PET_DATA_COMPARE_WRAPPER_BODY = canonicalExpectedBody(`
  if (ingress === undefined || !isOperationalChannel || duplicate !== false
    || event.direction !== "incoming" || !isPetDataCompareCommand(event.message)
    || event.userId === undefined || event.channelId === undefined) return "not_applicable";
  const result = await ingress.handle(event);
  if (result.status === "ignored") return "not_applicable";
  if (result.status === "legacy_fallback") return "legacy_fallback";
  return "claimed";
`);

function executableMask(span: SourceSpan | undefined, semanticStrings = false): string {
  if (span === undefined) return "";
  const chars = (semanticStrings ? semanticMask(span.source) : span.code).split("");
  const bodyOpen = span.code.indexOf("{");
  const blank = (start: number, end: number): void => { for (let index = start; index < end; index += 1) if (chars[index] !== "\n") chars[index] = " "; };
  for (const match of span.code.matchAll(/\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(/g)) {
    if ((match.index ?? 0) < bodyOpen + 1) continue;
    const parameterOpen = span.code.indexOf("(", match.index);
    const parameterEnd = balancedDelimiterEnd(span.code, parameterOpen, "(", ")");
    if (parameterEnd === undefined) continue;
    const nestedOpen = span.code.indexOf("{", parameterEnd);
    const nestedEnd = nestedOpen < 0 ? undefined : balancedBodyEnd(span.code, nestedOpen);
    if (nestedEnd !== undefined) blank(match.index!, nestedEnd);
  }
  for (const match of span.code.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?(?:(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>|function\s*\([^)]*\))\s*\{/g)) {
    const nestedOpen = span.code.indexOf("{", match.index);
    const nestedEnd = balancedBodyEnd(span.code, nestedOpen);
    if (nestedEnd !== undefined) blank(match.index!, nestedEnd);
  }
  for (const match of span.code.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>\s*[^\s{]/g)) {
    const end = span.code.indexOf(";", (match.index ?? 0) + match[0].length);
    blank(match.index!, end < 0 ? span.code.length : end + 1);
  }
  for (const match of span.code.matchAll(/\bif\s*\(\s*false\s*\)/g)) {
    const consequent = (match.index ?? 0) + match[0].length;
    let start = consequent;
    while (/\s/.test(span.code[start] ?? "")) start += 1;
    if (span.code[start] === "{") {
      const end = balancedBodyEnd(span.code, start);
      if (end !== undefined) blank(match.index!, end);
    } else {
      const end = span.code.indexOf(";", start);
      blank(match.index!, end < 0 ? span.code.length : end + 1);
    }
  }
  return chars.join("");
}

function executableCode(span: SourceSpan | undefined): string { return executableMask(span, false); }

function callCount(span: SourceSpan | undefined, callee: string): number {
  return [...executableCode(span).matchAll(new RegExp(`\\b${callee}\\s*(?:<[^>{}();]*>)?\\s*\\(`, "g"))].length;
}

function callArguments(span: SourceSpan | undefined, callee: string): string[] | undefined {
  const code = executableCode(span);
  const matches = [...code.matchAll(new RegExp(`\\b${callee}\\s*(?:<[^>{}();]*>)?\\s*\\(`, "g"))];
  if (matches.length !== 1 || matches[0]?.index === undefined) return undefined;
  const open = matches[0].index + matches[0][0].lastIndexOf("(");
  const end = balancedDelimiterEnd(code, open, "(", ")");
  if (end === undefined) return undefined;
  const argumentsFound: string[] = [];
  let start = open + 1;
  let parentheses = 0;
  let braces = 0;
  let brackets = 0;
  for (let index = start; index < end - 1; index += 1) {
    const current = code[index]!;
    if (current === "(") parentheses += 1;
    else if (current === ")") parentheses -= 1;
    else if (current === "{") braces += 1;
    else if (current === "}") braces -= 1;
    else if (current === "[") brackets += 1;
    else if (current === "]") brackets -= 1;
    else if (current === "," && parentheses === 0 && braces === 0 && brackets === 0) {
      argumentsFound.push(code.slice(start, index).trim());
      start = index + 1;
    }
  }
  const finalArgument = code.slice(start, end - 1).trim();
  if (finalArgument.length > 0) argumentsFound.push(finalArgument);
  return argumentsFound;
}

function propertyCallCount(span: SourceSpan | undefined, receiver: string, method: string): number {
  return [...executableCode(span).matchAll(new RegExp(`\\b${receiver}\\s*\\.\\s*${method}\\s*\\(`, "g"))].length;
}

function propertyCallArguments(span: SourceSpan | undefined, receiver: string, method: string): string[] | undefined {
  const code = executableCode(span);
  const matches = [...code.matchAll(new RegExp(`\\b${receiver}\\s*\\.\\s*${method}\\s*\\(`, "g"))];
  if (matches.length !== 1 || matches[0]?.index === undefined) return undefined;
  const open = matches[0].index + matches[0][0].lastIndexOf("(");
  const end = balancedDelimiterEnd(code, open, "(", ")");
  if (end === undefined) return undefined;
  const value = code.slice(open + 1, end - 1).trim();
  return value.length === 0 ? [] : [value];
}

function hasExactComposition(span: SourceSpan | undefined): {
  provider: boolean;
  routeReader: boolean;
  petExploreIngress: boolean;
  petDataCompareIngress: boolean;
  petTitleIngress: boolean;
} {
  const code = executableCode(span);
  const provider = /\bconst\s+appWiringOperationProvider\s*=[^;]*\bnew\s+MariaAppWiringOperationProvider\s*\(\s*database\s*,\s*dependencies\.environmentContext\s*\)/.test(code);
  const petExploreIngress = /\bconst\s+petExploreAppWiringIngress\s*=[^;]*\bnew\s+PetExploreAppWiringIngress\s*\(\s*appWiringOperationProvider\s*,\s*new\s+CommandDispatcher\s*\(\s*new\s+MariaCommandRouteReader\s*\(\s*database\s*\)/.test(code);
  const petDataCompareIngress = /\bconst\s+petDataCompareAppWiringIngress\s*=[^;]*\bnew\s+PetDataCompareAppWiringIngress\s*\(\s*appWiringOperationProvider\s*,\s*new\s+CommandDispatcher\s*\(\s*new\s+MariaCommandRouteReader\s*\(\s*database\s*\)/.test(code);
  const petTitleIngress = /\bconst\s+petTitleAppWiringIngress\s*=[\s\S]*?\bnew\s+PetTitleAppWiringIngress\s*\(\s*appWiringOperationProvider\s*,\s*new\s+CommandDispatcher\s*\(\s*new\s+MariaCommandRouteReader\s*\(\s*database\s*\)/.test(code);
  return { provider, routeReader: petExploreIngress && petDataCompareIngress && petTitleIngress, petExploreIngress, petDataCompareIngress, petTitleIngress };
}

function irisRouteCallback(buildApp: SourceSpan | undefined): SourceSpan | undefined {
  if (buildApp === undefined) return undefined;
  const code = codeMask(buildApp.source);
  for (const match of code.matchAll(/\bapp\s*\.\s*post\s*(?:<[^>]*>)?\s*\(/g)) {
    if (match.index === undefined) continue;
    const callOpen = match.index + match[0].lastIndexOf("(");
    const callEnd = balancedDelimiterEnd(code, callOpen, "(", ")");
    if (callEnd === undefined) continue;
    let firstArgument = callOpen + 1;
    while (/\s/.test(buildApp.source[firstArgument] ?? "")) firstArgument += 1;
    const routeLiteral = buildApp.source.slice(firstArgument).match(/^(?:"\/api\/v1\/integrations\/iris\/events"|'\/api\/v1\/integrations\/iris\/events')/);
    if (routeLiteral === null) continue;
    const callCode = code.slice(callOpen, callEnd);
    const callbacks = [...callCode.matchAll(/\basync\s*\(\s*request\s*,\s*reply\s*\)\s*=>\s*\{/g)];
    if (callbacks.length !== 1 || callbacks[0]?.index === undefined) return undefined;
    const localStart = callOpen + callbacks[0].index;
    const bodyOpen = code.indexOf("{", localStart + callbacks[0][0].length - 1);
    const bodyEnd = balancedBodyEnd(code, bodyOpen);
    if (bodyEnd === undefined || bodyEnd > callEnd) return undefined;
    return {
      start: buildApp.start + localStart,
      end: buildApp.start + bodyEnd,
      source: buildApp.source.slice(localStart, bodyEnd),
      code: code.slice(localStart, bodyEnd),
    };
  }
  return undefined;
}

function directTopLevelMatchCount(callback: SourceSpan | undefined, expression: RegExp): number {
  if (callback === undefined) return 0;
  const bodyOpen = callback.code.indexOf("{");
  const bodyEnd = bodyOpen < 0 ? undefined : balancedBodyEnd(callback.code, bodyOpen);
  if (bodyEnd === undefined) return 0;
  const body = callback.code.slice(bodyOpen + 1, bodyEnd - 1);
  let count = 0;
  for (const match of body.matchAll(expression)) {
    const target = match.index ?? -1;
    let braces = 0;
    let parentheses = 0;
    let brackets = 0;
    let statementBoundary = 0;
    for (let index = 0; index < target; index += 1) {
      if (body[index] === "{") braces += 1;
      else if (body[index] === "}") { braces -= 1; if (braces === 0 && parentheses === 0 && brackets === 0) statementBoundary = index + 1; }
      else if (body[index] === "(") parentheses += 1;
      else if (body[index] === ")") parentheses -= 1;
      else if (body[index] === "[") brackets += 1;
      else if (body[index] === "]") brackets -= 1;
      else if (body[index] === ";" && braces === 0 && parentheses === 0 && brackets === 0) statementBoundary = index + 1;
    }
    if (braces === 0 && parentheses === 0 && brackets === 0 && body.slice(statementBoundary, target).trim().length === 0) count += 1;
  }
  return count;
}

function hasDirectIrisDispatch(callback: SourceSpan | undefined): boolean {
  if (callback === undefined) return false;
  const normalizedEvent = directTopLevelMatchCount(callback, /\bconst\s+normalizedEvent\s*=\s*normalizeIrisEvent\s*\(\s*request\.body\s*\)\s*;/g) === 1;
  const processing = directTopLevelMatchCount(callback, /\bconst\s+processing\s*=/g) === 1;
  const dispatch = directTopLevelMatchCount(
    callback,
    /\bawait\s+dispatchPetExploreCommandConsumers\s*\(\s*petExploreAppWiringIngress\s*,\s*isOperationalChannel\s*,\s*processing\?\.duplicate\s*,\s*normalizedEvent\s*\)\s*;/g,
  ) === 1;
  return normalizedEvent && processing && dispatch;
}

function hasDirectPetDataCompareDispatch(callback: SourceSpan | undefined): boolean {
  if (callback === undefined) return false;
  const dispatch = directTopLevelMatchCount(
    callback,
    /\bconst\s+petDataCompareDisposition\s*=\s*await\s+dispatchPetDataCompareCommand\s*\(\s*petDataCompareAppWiringIngress\s*,\s*isOperationalChannel\s*,\s*processing\?\.duplicate\s*,\s*normalizedEvent\s*,?\s*\)\s*;/g,
  ) === 1;
  return dispatch;
}

function hasDirectPetTitleDispatch(callback: SourceSpan | undefined): boolean {
  if (callback === undefined) return false;
  return directTopLevelMatchCount(
    callback,
    /\bconst\s+petTitleDisposition\s*=\s*await\s+dispatchPetTitleCommand\s*\(\s*petTitleAppWiringIngress\s*,\s*isOperationalChannel\s*,\s*processing\?\.duplicate\s*,\s*normalizedEvent\s*,\s*processing\?\.replies\s*,?\s*\)\s*;/g,
  ) === 1;
}

function petTitleSellAdopted(handle: SourceSpan | undefined): boolean {
  if (handle === undefined) return false;
  const source = handle.source;
  const mutationRunnerCalls = executableCode(handle).match(/\bexecuteAppWiringMutationIrisEntrypoint\s*</g)?.length ?? 0;
  return /command\.kind\s*===\s*["']sell["']\s*&&\s*decision\.route\s*===\s*["']MODERN["']/.test(source)
    && mutationRunnerCalls === 1
    && /lockActivePlayerSelection\(\s*database\s*,\s*event\s*\)/.test(source)
    && /this\.mutations\.sell\(\s*database\s*,\s*activeClaim\s*,/.test(source)
    && /receiptKind\s*:\s*["']PET_TITLE["']/.test(source)
    && /status\s*:\s*["']handled_no_reply["']/.test(source);
}

function claimedOnlyBlocksLegacyAdmin(callback: SourceSpan | undefined): boolean {
  if (callback === undefined) return false;
  const code = executableMask(callback, true);
  const dispatch = code.search(/\bconst\s+petDataCompareDisposition\s*=\s*await\s+dispatchPetDataCompareCommand\s*\(/);
  const gate = code.search(/\bpetDataCompareDisposition\s*!==\s*["']C+["']/);
  if (dispatch < 0 || gate <= dispatch) return false;
  const comparisons = [...code.matchAll(/\bpetDataCompareDisposition\s*(?:===|!==)\s*["'][A-Z]+["']/g)];
  if (comparisons.length !== 1) return false;
  const ifStart = code.lastIndexOf("if", gate);
  const conditionOpen = ifStart < 0 ? -1 : code.indexOf("(", ifStart + 2);
  const conditionEnd = conditionOpen < 0 ? undefined : balancedDelimiterEnd(code, conditionOpen, "(", ")");
  if (conditionEnd === undefined || !/\bisPointEditCommandCandidate\s*\(\s*normalizedEvent\.message\s*\)/.test(code.slice(conditionOpen, conditionEnd))) return false;
  const bodyOpen = code.indexOf("{", conditionEnd);
  const bodyEnd = bodyOpen < 0 ? undefined : balancedBodyEnd(code, bodyOpen);
  if (bodyEnd === undefined) return false;
  return [...code.slice(bodyOpen, bodyEnd).matchAll(/\birisAdminCommandService\s*!?\s*\.\s*changePlayerPoint\s*\(/g)].length === 1;
}

function petDataComparePreconditionsBoundToResolve(handle: SourceSpan | undefined): boolean {
  if (handle === undefined) return false;
  const code = executableMask(handle, true);
  const resolve = code.search(/\bthis\s*\.\s*dispatcher\s*\.\s*resolveReadOnly\s*\(\s*dispatchInput\s*\)/);
  if (resolve < 0 || callCount(handle, "resolveReadOnly") !== 1 || callCount(handle, "isPetDataCompareCommand") !== 1) return false;
  const before = code.slice(0, resolve);
  return /!\s*isPetDataCompareCommand\s*\(\s*event\.message\s*\)/.test(before)
    && /event\.direction\s*!==\s*["']G+["']/.test(before)
    && /event\.userId\s*===\s*undefined/.test(before)
    && /event\.channelId\s*===\s*undefined/.test(before)
    && /\breturn\b/.test(before);
}

function petDataCompareTrustForwarded(handle: SourceSpan | undefined, claim: ParsedObject): boolean {
  if (handle === undefined) return false;
  const beforeRunner = executableMask(handle, true).split(new RegExp(`\\b${RUNNER_NAME}\\b`), 1)[0] ?? "";
  const dispatchTrust = /\bhasTrustedDisplayName\s*:\s*event\.displayNameTrust\s*===\s*["']T+["']/.test(beforeRunner);
  const payload = parseTopLevelObject(propertyObject(claim, "normalizedPayload"));
  const payloadTrust = property(payload, "trustedDisplayName")?.valueCode.replace(/\s/g, "") ?? "";
  return dispatchTrust
    && objectShapeValid(payload)
    && payloadTrust === 'event.displayNameTrust==="TTTTTTT"';
}

function hasRunnerImport(source: string): boolean {
  return /^\s*import\s*\{[^\n}]*\bexecuteAppWiringEntrypoint\b[^\n}]*\}\s*from\s*["']R+["']\s*;/m.test(semanticMask(source));
}

interface RunnerInvocation { readonly firstArgument: string; readonly options: SourceSpan }

function runnerInvocation(span: SourceSpan | undefined): RunnerInvocation | undefined {
  if (span === undefined) return undefined;
  const code = executableCode(span);
  const semanticCode = executableMask(span, true);
  const matches = [...code.matchAll(new RegExp(`\\b${RUNNER_NAME}\\s*(?:<[^>{}();]*>)?\\s*\\(`, "g"))];
  if (matches.length !== 1 || matches[0]?.index === undefined) return undefined;
  const callOpen = matches[0].index + matches[0][0].lastIndexOf("(");
  const callEnd = balancedDelimiterEnd(code, callOpen, "(", ")");
  if (callEnd === undefined) return undefined;
  let parentheses = 1;
  let braces = 0;
  let brackets = 0;
  let comma = -1;
  for (let index = callOpen + 1; index < callEnd - 1; index += 1) {
    if (code[index] === "(") parentheses += 1;
    else if (code[index] === ")") parentheses -= 1;
    else if (code[index] === "{") braces += 1;
    else if (code[index] === "}") braces -= 1;
    else if (code[index] === "[") brackets += 1;
    else if (code[index] === "]") brackets -= 1;
    else if (code[index] === "," && parentheses === 1 && braces === 0 && brackets === 0) { comma = index; break; }
  }
  if (comma < 0) return undefined;
  const firstArgument = code.slice(callOpen + 1, comma).trim();
  let objectOpen = comma + 1;
  while (/\s/.test(code[objectOpen] ?? "")) objectOpen += 1;
  if (code[objectOpen] !== "{") return undefined;
  const objectEnd = balancedBodyEnd(code, objectOpen);
  if (objectEnd === undefined || objectEnd > callEnd) return undefined;
  return {
    firstArgument,
    options: { start: span.start + objectOpen, end: span.start + objectEnd, source: span.source.slice(objectOpen, objectEnd), code: semanticCode.slice(objectOpen, objectEnd) },
  };
}

interface ParsedObjectProperty { readonly name: string; readonly valueSource: string; readonly valueCode: string }
interface ParsedObject { readonly properties: readonly ParsedObjectProperty[]; readonly invalidMember: boolean; readonly duplicateNames: readonly string[] }

function parseTopLevelObject(object: SourceSpan | undefined): ParsedObject {
  if (object === undefined || object.code[0] !== "{") return { properties: [], invalidMember: true, duplicateNames: [] };
  const properties: ParsedObjectProperty[] = [];
  let invalidMember = false;
  let index = 1;
  while (index < object.code.length - 1) {
    while (index < object.code.length - 1 && /[\s,]/.test(object.code[index]!)) index += 1;
    if (index >= object.code.length - 1) break;
    if (object.code.startsWith("...", index) || object.code[index] === "[") { invalidMember = true; break; }
    const nameMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(object.code.slice(index));
    if (nameMatch === null) { invalidMember = true; break; }
    const name = nameMatch[0];
    index += name.length;
    while (/\s/.test(object.code[index] ?? "")) index += 1;
    if (object.code[index] !== ":") { invalidMember = true; break; }
    index += 1;
    while (/\s/.test(object.code[index] ?? "")) index += 1;
    const valueStart = index;
    let braces = 0;
    let parentheses = 0;
    let brackets = 0;
    while (index < object.code.length - 1) {
      const current = object.code[index]!;
      if (current === "{") braces += 1;
      else if (current === "}") { if (braces === 0) break; braces -= 1; }
      else if (current === "(") parentheses += 1;
      else if (current === ")") parentheses -= 1;
      else if (current === "[") brackets += 1;
      else if (current === "]") brackets -= 1;
      else if (current === "," && braces === 0 && parentheses === 0 && brackets === 0) break;
      index += 1;
    }
    properties.push({ name, valueSource: object.source.slice(valueStart, index).trim(), valueCode: object.code.slice(valueStart, index).trim() });
    if (object.code[index] === ",") index += 1;
  }
  const counts = new Map<string, number>();
  for (const property of properties) counts.set(property.name, (counts.get(property.name) ?? 0) + 1);
  return { properties, invalidMember, duplicateNames: [...counts].filter(([, count]) => count > 1).map(([name]) => name) };
}

function property(parsed: ParsedObject, name: string): ParsedObjectProperty | undefined {
  return parsed.properties.find((candidate) => candidate.name === name);
}

function propertyObject(parsed: ParsedObject, name: string): SourceSpan | undefined {
  const value = property(parsed, name);
  if (value === undefined || value.valueCode[0] !== "{") return undefined;
  const end = balancedBodyEnd(value.valueCode, 0);
  if (end === undefined || value.valueCode.slice(end).trim().length > 0) return undefined;
  return { start: 0, end, source: value.valueSource.slice(0, end), code: value.valueCode.slice(0, end) };
}

function objectShapeValid(parsed: ParsedObject): boolean {
  return !parsed.invalidMember && parsed.duplicateNames.length === 0;
}

function routeClosed(span: SourceSpan | undefined, route: "LEGACY_FALLBACK" | "MODERN", abrupt: "return" | "throw"): boolean {
  if (span === undefined) return false;
  const marker = route === "LEGACY_FALLBACK" ? "L+" : "M+";
  const safe = executableMask(span, true);
  const match = new RegExp(`if\\s*\\(\\s*decision\\.route\\s*===\\s*["']${marker}["']\\s*\\)[^{;]*(?:\\{[^}]*\\b${abrupt}\\b|\\b${abrupt}\\b)`, "s").exec(safe);
  const runnerIndex = executableCode(span).search(new RegExp(`\\b${RUNNER_NAME}\\s*(?:<[^>{}();]*>)?\\s*\\(`));
  return match?.index !== undefined && runnerIndex >= 0 && match.index < runnerIndex;
}

function handlerClosed(handlers: ParsedObject, route: "MODERN" | "LEGACY_FALLBACK"): boolean {
  const handler = parseTopLevelObject(propertyObject(handlers, route));
  const names = handler.properties.map(({ name }) => name).sort();
  const read = property(handler, "READ_ONLY")?.valueCode ?? "";
  const mutation = property(handler, "MUTATION")?.valueCode ?? "";
  return objectShapeValid(handler)
    && names.length === 2 && names[0] === "MUTATION" && names[1] === "READ_ONLY"
    && read === "forbiddenMutation"
    && /^forbiddenMutation(?:\s+as[\s\S]+)?$/.test(mutation);
}

function settlementModernClosed(span: SourceSpan | undefined): boolean {
  if (span === undefined) return false;
  const source = executableMask(span, true);
  const guard = /if\s*\(\s*decision\.route\s*===\s*["']M+["']\s*&&\s*family\s*!==\s*["']E+["']\s*\)\s*throw\b/s.exec(source);
  const runnerIndex = executableCode(span).search(new RegExp(`\\b${RUNNER_NAME}\\s*(?:<[^>{}();]*>)?\\s*\\(`));
  return guard?.index !== undefined && runnerIndex > guard.index;
}

function eventControlModernHandlerAdopted(handlers: ParsedObject): boolean {
  const modern = parseTopLevelObject(propertyObject(handlers, "MODERN"));
  const names = modern.properties.map(({ name }) => name).sort();
  const read = property(modern, "READ_ONLY")?.valueCode ?? "";
  const mutation = property(modern, "MUTATION")?.valueSource ?? "";
  return objectShapeValid(modern)
    && names.length === 2 && names[0] === "MUTATION" && names[1] === "READ_ONLY"
    && read === "forbiddenMutation"
    && /^async\s*\([^)]*database[^)]*claim[^)]*\)\s*=>/.test(mutation)
    && /if\s*\(\s*family\s*!==\s*["']EVENT_CONTROL["']\s*\)\s*return\s+forbiddenMutation\(\)/s.test(mutation)
    && /this\.eventControlProvider\.execute\(\s*database\s*,\s*event\s*,\s*claim\s*\)/s.test(mutation)
    && /receiptKind\s*:\s*["']PET_EXPLORE_EVENT_CONTROL["']/s.test(mutation)
    && /petExploreEventControlOperationId\s*:\s*result\.operationId/s.test(mutation);
}

function petExploreEffectModeBound(span: SourceSpan | undefined): boolean {
  if (span === undefined) return false;
  return /effectMode\s*:\s*decision\.route\s*===\s*["']MODERN["']\s*\?\s*["']MUTATION["']\s+as\s+const\s*:\s*["']READ_ONLY["']\s+as\s+const/s.test(span.source);
}

function callableHandler(handlers: ParsedObject, name: "SHADOW" | "REJECT"): boolean {
  const value = property(handlers, name)?.valueCode ?? "";
  return /^async\s*(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.test(value);
}

function exactStringProperty(parsed: ParsedObject, name: string, expected: string): boolean {
  const value = property(parsed, name)?.valueSource;
  return value !== undefined && (value === `"${expected}"` || value === `'${expected}'`);
}

function readOnlyRouteBoundToRunner(handle: SourceSpan | undefined, options: ParsedObject): boolean {
  if (handle === undefined) return false;
  const semantic = executableMask(handle, true);
  const runnerIndex = executableCode(handle).search(new RegExp(`\\b${RUNNER_NAME}\\s*(?:<[^>{}();]*>)?\\s*\\(`));
  const routeIndex = semantic.search(/\bconst\s+route\s*=\s*\{[^;]*\.\.\.decision[^;]*\beffectMode\s*:\s*["']D+["'][^;]*\}/s);
  const resolver = property(options, "resolveRoute")?.valueCode.replace(/\s/g, "") ?? "";
  return routeIndex >= 0 && runnerIndex > routeIndex && resolver === "()=>route";
}

export function auditObjectDbRuntimeAdoptionSources(input: ObjectDbRuntimeAdoptionSources, expectedHashes: ObjectDbRuntimeAdoptionExpectedHashes): ObjectDbRuntimeAdoptionAuditResult {
  const appSource = canonicalLf(input.appSource);
  const ingressSource = canonicalLf(input.petExploreIngressSource);
  const eventControlProviderSource = canonicalLf(input.petExploreEventControlProviderSource);
  const appWiringOperationProviderSource = canonicalLf(input.appWiringOperationProviderSource);
  const eventControlMigrationSource = canonicalLf(input.petExploreEventControlMigrationSource);
  const eventControlRollbackSource = canonicalLf(input.petExploreEventControlRollbackSource);
  const adminIngressSource = canonicalLf(input.petDataCompareIngressSource);
  const adminEvaluatorSource = canonicalLf(input.petDataCompareShadowEvaluatorSource);
  const petTitleIngressSource = canonicalLf(input.petTitleIngressSource);
  const petTitleMutationProviderSource = canonicalLf(input.petTitleMutationProviderSource);
  const failures: string[] = [];
  const buildApp = namedFunction(appSource, "buildApp");
  const dispatcher = namedFunction(appSource, "dispatchPetExploreCommandConsumers");
  const wrappers = WRAPPER_NAMES.map((name) => namedFunction(appSource, name));
  const handle = namedClassMethod(ingressSource, "PetExploreAppWiringIngress", "handle");
  const adminWrapper = namedFunction(appSource, "dispatchPetDataCompareCommand");
  const adminHandle = namedClassMethod(adminIngressSource, "PetDataCompareAppWiringIngress", "handle");
  const petTitleHandle = namedClassMethod(petTitleIngressSource, "PetTitleAppWiringIngress", "handle");
  const composition = hasExactComposition(buildApp);
  const invocation = runnerInvocation(handle);
  const options = parseTopLevelObject(invocation?.options);
  const claim = parseTopLevelObject(propertyObject(options, "claim"));
  const handlers = parseTopLevelObject(propertyObject(options, "handlers"));
  const adminInvocation = runnerInvocation(adminHandle);
  const adminOptions = parseTopLevelObject(adminInvocation?.options);
  const adminClaim = parseTopLevelObject(propertyObject(adminOptions, "claim"));
  const adminHandlers = parseTopLevelObject(propertyObject(adminOptions, "handlers"));
  const irisCallback = irisRouteCallback(buildApp);

  if (sha256(appSource) !== expectedHashes.appSourceSha256) failures.push("APP_SOURCE_HASH_MISMATCH");
  if (sha256(ingressSource) !== expectedHashes.petExploreIngressSourceSha256) failures.push("PET_EXPLORE_INGRESS_SOURCE_HASH_MISMATCH");
  if (sha256(eventControlProviderSource) !== expectedHashes.petExploreEventControlProviderSourceSha256) failures.push("PET_EXPLORE_EVENT_CONTROL_PROVIDER_SOURCE_HASH_MISMATCH");
  if (sha256(appWiringOperationProviderSource) !== expectedHashes.appWiringOperationProviderSourceSha256) failures.push("APP_WIRING_OPERATION_PROVIDER_SOURCE_HASH_MISMATCH");
  if (sha256(eventControlMigrationSource) !== expectedHashes.petExploreEventControlMigrationSourceSha256) failures.push("PET_EXPLORE_EVENT_CONTROL_MIGRATION_SOURCE_HASH_MISMATCH");
  if (sha256(eventControlRollbackSource) !== expectedHashes.petExploreEventControlRollbackSourceSha256) failures.push("PET_EXPLORE_EVENT_CONTROL_ROLLBACK_SOURCE_HASH_MISMATCH");
  if (sha256(adminIngressSource) !== expectedHashes.petDataCompareIngressSourceSha256) failures.push("PET_DATA_COMPARE_INGRESS_SOURCE_HASH_MISMATCH");
  if (sha256(adminEvaluatorSource) !== expectedHashes.petDataCompareShadowEvaluatorSourceSha256) failures.push("PET_DATA_COMPARE_SHADOW_EVALUATOR_SOURCE_HASH_MISMATCH");
  if (sha256(petTitleIngressSource) !== expectedHashes.petTitleIngressSourceSha256) failures.push("PET_TITLE_INGRESS_SOURCE_HASH_MISMATCH");
  if (sha256(petTitleMutationProviderSource) !== expectedHashes.petTitleMutationProviderSourceSha256) failures.push("PET_TITLE_MUTATION_PROVIDER_SOURCE_HASH_MISMATCH");

  const expectedParameters = ["ingress", "isOperationalChannel", "duplicate", "event"];
  if (functionParameterNames(dispatcher)?.join(",") !== expectedParameters.join(",")) failures.push("DISPATCH_PARAMETER_CONTRACT_INVALID");
  if (canonicalFunctionBody(dispatcher) !== DISPATCH_BODY) failures.push("DISPATCH_BODY_CONTRACT_INVALID");
  if (callCount(buildApp, "dispatchPetExploreCommandConsumers") !== 1 || !hasDirectIrisDispatch(irisCallback)) failures.push("BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE");
  for (let index = 0; index < WRAPPER_NAMES.length; index += 1) {
    const name = WRAPPER_NAMES[index]!;
    if (functionParameterNames(wrappers[index])?.join(",") !== expectedParameters.join(",")) failures.push(`WRAPPER_PARAMETER_CONTRACT_INVALID:${name}`);
    const expectedBody = index === 0 ? SETTLEMENT_WRAPPER_BODY : EVENT_CONTROL_WRAPPER_BODY;
    if (canonicalFunctionBody(wrappers[index]) !== expectedBody) failures.push(`WRAPPER_BODY_CONTRACT_INVALID:${name}`);
    const argumentsFound = callArguments(dispatcher, name);
    if (callCount(dispatcher, name) !== 1
      || argumentsFound === undefined
      || argumentsFound.join(",") !== "ingress,isOperationalChannel,duplicate,event") failures.push(`DISPATCH_WRAPPER_NOT_EXACTLY_ONCE:${name}`);
    if (propertyCallCount(wrappers[index], "ingress", "handle") !== 1
      || propertyCallArguments(wrappers[index], "ingress", "handle")?.join(",") !== "event") failures.push(`INGRESS_HANDLE_NOT_EXACTLY_ONCE:${name}`);
    const expectedGuard = index === 0 ? "isPetExploreSettlementCommand" : "isPetExploreEventControlCommand";
    if (callCount(wrappers[index], expectedGuard) !== 1) failures.push(`INGRESS_FAMILY_GUARD_MISSING:${name}`);
  }
  if (!composition.provider) failures.push("APP_WIRING_PROVIDER_COMPOSITION_MISSING");
  if (!composition.routeReader) failures.push("READ_ONLY_ROUTE_READER_COMPOSITION_MISSING");
  if (!composition.petExploreIngress) failures.push("PET_EXPLORE_INGRESS_COMPOSITION_MISSING");
  if (!composition.petDataCompareIngress) failures.push("PET_DATA_COMPARE_INGRESS_COMPOSITION_MISSING");
  if (!composition.petTitleIngress) failures.push("PET_TITLE_INGRESS_COMPOSITION_MISSING");
  if (!hasRunnerImport(ingressSource)) failures.push("RUNNER_IMPORT_MISSING");
  if (callCount(handle, RUNNER_NAME) !== 1) failures.push("RUNNER_CALLSITE_NOT_EXACTLY_ONCE");
  if (invocation?.firstArgument !== "this.provider") failures.push("RUNNER_PROVIDER_ARGUMENT_INVALID");
  if (!objectShapeValid(options)) failures.push("RUNNER_OPTIONS_OBJECT_INVALID");
  if (!objectShapeValid(claim)) failures.push("RUNNER_CLAIM_OBJECT_INVALID");
  if (!objectShapeValid(handlers)) failures.push("RUNNER_HANDLERS_OBJECT_INVALID");
  if (!routeClosed(handle, "LEGACY_FALLBACK", "return")) failures.push("LEGACY_EXECUTION_NOT_CLOSED");
  if (!settlementModernClosed(handle)) failures.push("SETTLEMENT_MODERN_EXECUTION_NOT_CLOSED");
  if (!eventControlModernHandlerAdopted(handlers)) failures.push("EVENT_CONTROL_MODERN_HANDLER_NOT_ADOPTED");
  if (!petExploreEffectModeBound(handle)) failures.push("PET_EXPLORE_EFFECT_MODE_NOT_FAMILY_BOUND");
  if (!handlerClosed(handlers, "LEGACY_FALLBACK")) failures.push("LEGACY_HANDLER_NOT_CLOSED");
  if (!callableHandler(handlers, "SHADOW") || !callableHandler(handlers, "REJECT")) failures.push("SHADOW_REJECT_HANDLERS_MISSING");
  const irisClaim = exactStringProperty(claim, "entrypointKind", "IRIS");
  const petExploreActor = exactStringProperty(claim, "actor", "pet_explore_app_wiring");
  if (!irisClaim) failures.push("IRIS_ENTRYPOINT_CLAIM_MISSING");
  if (!petExploreActor) failures.push("PET_EXPLORE_DOMAIN_CLAIM_MISSING");

  if (functionParameterNames(adminWrapper)?.join(",") !== expectedParameters.join(",")) failures.push("PET_DATA_COMPARE_WRAPPER_PARAMETER_CONTRACT_INVALID");
  if (canonicalFunctionBody(adminWrapper) !== PET_DATA_COMPARE_WRAPPER_BODY) failures.push("PET_DATA_COMPARE_WRAPPER_BODY_CONTRACT_INVALID");
  if (propertyCallCount(adminWrapper, "ingress", "handle") !== 1
    || propertyCallArguments(adminWrapper, "ingress", "handle")?.join(",") !== "event") failures.push("PET_DATA_COMPARE_INGRESS_HANDLE_NOT_EXACTLY_ONCE");
  if (callCount(adminWrapper, "isPetDataCompareCommand") !== 1) failures.push("PET_DATA_COMPARE_EXACT_GUARD_MISSING");
  if (callCount(buildApp, "dispatchPetDataCompareCommand") !== 1 || !hasDirectPetDataCompareDispatch(irisCallback)) failures.push("PET_DATA_COMPARE_BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE");
  if (!claimedOnlyBlocksLegacyAdmin(irisCallback)) failures.push("PET_DATA_COMPARE_LEGACY_ADMIN_ORDER_INVALID");

  if (!hasRunnerImport(adminIngressSource)) failures.push("PET_DATA_COMPARE_RUNNER_IMPORT_MISSING");
  if (callCount(adminHandle, RUNNER_NAME) !== 1) failures.push("PET_DATA_COMPARE_RUNNER_CALLSITE_NOT_EXACTLY_ONCE");
  if (adminInvocation?.firstArgument !== "this.provider") failures.push("PET_DATA_COMPARE_RUNNER_PROVIDER_ARGUMENT_INVALID");
  if (!objectShapeValid(adminOptions)) failures.push("PET_DATA_COMPARE_RUNNER_OPTIONS_OBJECT_INVALID");
  if (!objectShapeValid(adminClaim)) failures.push("PET_DATA_COMPARE_RUNNER_CLAIM_OBJECT_INVALID");
  if (!objectShapeValid(adminHandlers)) failures.push("PET_DATA_COMPARE_RUNNER_HANDLERS_OBJECT_INVALID");
  if (!routeClosed(adminHandle, "LEGACY_FALLBACK", "return")) failures.push("PET_DATA_COMPARE_LEGACY_EXECUTION_NOT_CLOSED");
  if (!routeClosed(adminHandle, "MODERN", "throw")) failures.push("PET_DATA_COMPARE_MODERN_EXECUTION_NOT_CLOSED");
  if (!petDataComparePreconditionsBoundToResolve(adminHandle)) failures.push("PET_DATA_COMPARE_PRECONDITIONS_OR_RESOLVE_INVALID");
  if (!handlerClosed(adminHandlers, "MODERN")) failures.push("PET_DATA_COMPARE_MODERN_HANDLER_NOT_CLOSED");
  if (!handlerClosed(adminHandlers, "LEGACY_FALLBACK")) failures.push("PET_DATA_COMPARE_LEGACY_HANDLER_NOT_CLOSED");
  if (!callableHandler(adminHandlers, "SHADOW") || !callableHandler(adminHandlers, "REJECT")) failures.push("PET_DATA_COMPARE_SHADOW_REJECT_HANDLERS_MISSING");
  if (!exactStringProperty(adminClaim, "entrypointKind", "IRIS")) failures.push("PET_DATA_COMPARE_IRIS_ENTRYPOINT_CLAIM_MISSING");
  if (!exactStringProperty(adminClaim, "actor", "pet_data_compare_app_wiring")) failures.push("PET_DATA_COMPARE_DOMAIN_CLAIM_MISSING");
  if (!petDataCompareTrustForwarded(adminHandle, adminClaim)) failures.push("PET_DATA_COMPARE_TRUST_FORWARDING_INVALID");
  if (!readOnlyRouteBoundToRunner(adminHandle, adminOptions)) failures.push("PET_DATA_COMPARE_READ_ONLY_EFFECT_NOT_BOUND");
  if (!hasDirectPetTitleDispatch(irisCallback)) failures.push("PET_TITLE_BUILD_APP_DISPATCH_PATH_MISSING_OR_DUPLICATE");
  if (!petTitleSellAdopted(petTitleHandle)) failures.push("PET_TITLE_SELL_MODERN_HANDLER_NOT_ADOPTED");

  const compliant = failures.length === 0;
  const callSites: ObjectDbRuntimeAdoptionCallSite[] = compliant ? [
    {
      sourceFile: PET_EXPLORE_INGRESS_FILE,
      functionName: "PetExploreAppWiringIngress.handle",
      entrypointKind: "IRIS",
      domain: "PET_EXPLORE",
      effectModes: ["MODERN_MUTATION", "SHADOW", "REJECT"],
    },
    {
      sourceFile: PET_DATA_COMPARE_INGRESS_FILE,
      functionName: "PetDataCompareAppWiringIngress.handle",
      entrypointKind: "IRIS",
      domain: "ADMIN_PET_DATA_COMPARE",
      effectModes: ["SHADOW", "REJECT"],
    },
    {
      sourceFile: PET_TITLE_INGRESS_FILE,
      functionName: "PetTitleAppWiringIngress.handle",
      entrypointKind: "IRIS",
      domain: "PET_TITLE",
      effectModes: ["MODERN_MUTATION", "SHADOW", "REJECT"],
    },
  ] : [];
  return Object.freeze({
    compliant,
    productionSourceCallCount: compliant ? 3 : 0,
    callSites: Object.freeze(callSites),
    connectedIngressFamilies: Object.freeze(compliant ? ["EVENT_CONTROL", "SETTLEMENT", "ADMIN_PET_DATA_COMPARE", "PET_TITLE_SELL"] : []),
    failures: Object.freeze(failures),
  });
}

export function auditObjectDbRuntimeAdoption(runtimeRoot: string, expectedHashes: ObjectDbRuntimeAdoptionExpectedHashes): ObjectDbRuntimeAdoptionAuditResult {
  const readCanonical = (relativePath: string): string => canonicalLf(readFileSync(resolve(runtimeRoot, relativePath), "utf8"));
  return auditObjectDbRuntimeAdoptionSources({
    appSource: readCanonical(APP_FILE),
    petExploreIngressSource: readCanonical(PET_EXPLORE_INGRESS_FILE),
    petExploreEventControlProviderSource: readCanonical(PET_EXPLORE_EVENT_CONTROL_PROVIDER_FILE),
    appWiringOperationProviderSource: readCanonical(APP_WIRING_OPERATION_PROVIDER_FILE),
    petExploreEventControlMigrationSource: readCanonical(PET_EXPLORE_EVENT_CONTROL_MIGRATION_FILE),
    petExploreEventControlRollbackSource: readCanonical(PET_EXPLORE_EVENT_CONTROL_ROLLBACK_FILE),
    petDataCompareIngressSource: readCanonical(PET_DATA_COMPARE_INGRESS_FILE),
    petDataCompareShadowEvaluatorSource: readCanonical(PET_DATA_COMPARE_SHADOW_EVALUATOR_FILE),
    petTitleIngressSource: readCanonical(PET_TITLE_INGRESS_FILE),
    petTitleMutationProviderSource: readCanonical(PET_TITLE_MUTATION_PROVIDER_FILE),
  }, expectedHashes);
}
