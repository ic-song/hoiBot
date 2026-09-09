import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript5";
import type { HttpRouteSurfaceEntry } from "./http-route-surface-audit.js";

export interface HttpRouteBindingMethodEvidence {
  file: string;
  symbol: string;
  sha256: string;
}

export interface HttpRouteCompositionBindingEvidence {
  endpointKey: string;
  registrar: string;
  dependencyCalls: string[];
  bindingTypes: string[];
  methodClosure: HttpRouteBindingMethodEvidence[];
  observedSqlReadTables: string[];
  observedSqlWriteTables: string[];
  unresolvedReasons: string[];
  resolved: boolean;
  evidenceSha256: string;
}

interface ConcreteInstance {
  kind: "instance";
  declaration: ts.ClassDeclaration;
  argumentsByProperty: Map<string, ConcreteValue>;
  typeName: string;
}

interface ConcreteFunction {
  kind: "function";
  declaration: ts.FunctionLikeDeclaration;
  typeName: string;
}

interface DatabaseValue { kind: "database"; typeName: string; }
interface ScalarValue { kind: "scalar"; typeName: string; }
interface UnresolvedValue { kind: "unresolved"; typeName: string; reason: string; }
type ConcreteValue = ConcreteInstance | ConcreteFunction | DatabaseValue | ScalarValue | UnresolvedValue;

interface AnalysisState {
  methods: Map<string, HttpRouteBindingMethodEvidence>;
  chunks: string[];
  unresolved: Set<string>;
  visited: Set<string>;
}

const SQL_READ = /\b(?:FROM|JOIN)\s+`?([a-z][a-z0-9_]*)`?/gi;
const SQL_WRITE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?([a-z][a-z0-9_]*)`?/gi;

function unique(values: Iterable<string>): string[] { return [...new Set(values)].sort(); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function normalPath(value: string): string { return value.split(sep).join("/"); }

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
}

function symbolDeclaration(checker: ts.TypeChecker, node: ts.Node): ts.Declaration | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  const target = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  return target?.valueDeclaration ?? target?.declarations?.[0];
}

function classDeclaration(checker: ts.TypeChecker, expression: ts.Expression): ts.ClassDeclaration | undefined {
  const declaration = symbolDeclaration(checker, expression);
  if (declaration !== undefined && ts.isClassDeclaration(declaration)) return declaration;
  const type = checker.getTypeAtLocation(expression);
  return type.getSymbol()?.declarations?.find(ts.isClassDeclaration);
}

function propertyName(parameter: ts.ParameterDeclaration): string | undefined {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
}

function memberName(name: ts.PropertyName | ts.PrivateIdentifier): string | undefined {
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function constInitializer(declaration: ts.Declaration | undefined): ts.Expression | undefined {
  return declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
    && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    ? declaration.initializer : undefined;
}

function isStaticDataExpression(checker: ts.TypeChecker, expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
  const value = unwrap(expression);
  if (seen.has(value)) return true;
  seen.add(value);
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)
    || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword
    || value.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(value)) return isStaticDataExpression(checker, value.operand, seen);
  if (ts.isArrayLiteralExpression(value)) return value.elements.every((entry) =>
    ts.isSpreadElement(entry) ? isStaticDataExpression(checker, entry.expression, seen) : isStaticDataExpression(checker, entry, seen));
  if (ts.isObjectLiteralExpression(value)) return value.properties.every((property) => {
    if (ts.isPropertyAssignment(property)) return isStaticDataExpression(checker, property.initializer, seen);
    if (ts.isShorthandPropertyAssignment(property)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(property);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      const initializer = constInitializer(declaration);
      return initializer !== undefined && isStaticDataExpression(checker, initializer, seen);
    }
    return false;
  });
  if (ts.isIdentifier(value)) {
    const declaration = symbolDeclaration(checker, value);
    const initializer = constInitializer(declaration);
    return initializer !== undefined && isStaticDataExpression(checker, initializer, seen);
  }
  return false;
}

function resolveValue(checker: ts.TypeChecker, expression: ts.Expression, seen = new Set<ts.Node>()): ConcreteValue {
  const value = unwrap(expression);
  if (seen.has(value)) return { kind: "unresolved", typeName: checker.typeToString(checker.getTypeAtLocation(value)), reason: "BINDING_CYCLE" };
  seen.add(value);
  if (ts.isNewExpression(value)) {
    if (ts.isIdentifier(value.expression) && /^(?:Map|Set|WeakMap|WeakSet)$/.test(value.expression.text)) {
      return { kind: "scalar", typeName: value.expression.text };
    }
    const declaration = classDeclaration(checker, value.expression);
    if (declaration === undefined) return { kind: "unresolved", typeName: value.expression.getText(), reason: "CONCRETE_CLASS_NOT_FOUND" };
    const constructor = declaration.members.find(ts.isConstructorDeclaration);
    const argumentsByProperty = new Map<string, ConcreteValue>();
    for (let index = 0; index < (constructor?.parameters.length ?? 0); index += 1) {
      const parameter = constructor!.parameters[index]!;
      const name = propertyName(parameter);
      const argument = value.arguments?.[index] ?? parameter.initializer;
      if (name !== undefined && argument !== undefined) argumentsByProperty.set(name, resolveValue(checker, argument, new Set(seen)));
    }
    if (constructor?.body !== undefined) {
      for (const statement of constructor.body.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)
          || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
        const left = unwrap(statement.expression.left);
        if (!ts.isPropertyAccessExpression(left) || left.expression.kind !== ts.SyntaxKind.ThisKeyword) continue;
        const name = memberName(left.name);
        if (name !== undefined) argumentsByProperty.set(name, resolveValue(checker, statement.expression.right, new Set(seen)));
      }
    }
    return { kind: "instance", declaration, argumentsByProperty, typeName: declaration.name?.text ?? value.expression.getText() };
  }
  if (ts.isIdentifier(value)) {
    if (value.text === "database" || /^(?:transaction|connection)$/.test(value.text)) return { kind: "database", typeName: value.text };
    const declaration = symbolDeclaration(checker, value);
    if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      return resolveValue(checker, declaration.initializer, new Set(seen));
    }
    if (declaration !== undefined && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)
      || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration))) {
      return { kind: "function", declaration, typeName: value.text };
    }
    const typeName = checker.typeToString(checker.getTypeAtLocation(value));
    if (/^(?:boolean|string|number|undefined|Set<|ReadonlySet<)/.test(typeName)) return { kind: "scalar", typeName };
    return { kind: "unresolved", typeName, reason: `IDENTIFIER_BINDING_NOT_CONCRETE:${value.text}` };
  }
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return { kind: "function", declaration: value, typeName: "inline-function" };
  if (isStaticDataExpression(checker, value)) return { kind: "scalar", typeName: checker.typeToString(checker.getTypeAtLocation(value)) };
  if (ts.isPropertyAccessExpression(value)) {
    const declaration = symbolDeclaration(checker, value.name);
    if (declaration !== undefined && ts.isPropertyDeclaration(declaration) && declaration.initializer !== undefined) {
      return resolveValue(checker, declaration.initializer, new Set(seen));
    }
    if (declaration !== undefined && !declaration.getSourceFile().fileName.includes(`${sep}runtime${sep}src${sep}`)) {
      return { kind: "scalar", typeName: checker.typeToString(checker.getTypeAtLocation(value)) };
    }
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    // Equal display types do not prove equal constructor arguments or closure.
    // Preserve injectable/fallback alternatives as unresolved until their full
    // binding identities are proven byte-for-byte.
    return { kind: "unresolved", typeName: checker.typeToString(checker.getTypeAtLocation(value)), reason: "NULLISH_BINDING_NOT_UNIQUE" };
  }
  if (ts.isConditionalExpression(value)) {
    return { kind: "unresolved", typeName: checker.typeToString(checker.getTypeAtLocation(value)), reason: "CONDITIONAL_BINDING_NOT_UNIQUE" };
  }
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "scalar", typeName: checker.typeToString(checker.getTypeAtLocation(value)) };
  }
  return { kind: "unresolved", typeName: checker.typeToString(checker.getTypeAtLocation(value)), reason: `UNSUPPORTED_BINDING:${ts.SyntaxKind[value.kind]}` };
}

function classMember(instance: ConcreteInstance, name: string, checker: ts.TypeChecker): ConcreteValue | undefined {
  const injected = instance.argumentsByProperty.get(name);
  if (injected !== undefined) return injected;
  const property = instance.declaration.members.find((member): member is ts.PropertyDeclaration =>
    ts.isPropertyDeclaration(member) && memberName(member.name) === name);
  if (property?.initializer !== undefined) return resolveValue(checker, property.initializer);
  return undefined;
}

function methodDeclaration(instance: ConcreteInstance, methodName: string): ts.MethodDeclaration | undefined {
  return instance.declaration.members.find((member): member is ts.MethodDeclaration =>
    ts.isMethodDeclaration(member) && memberName(member.name) === methodName);
}

function nodeKey(node: ts.Node): string {
  return `${normalPath(node.getSourceFile().fileName)}:${node.pos}:${node.end}`;
}

function recordMethod(repoRoot: string, declaration: ts.FunctionLikeDeclaration, symbol: string, state: AnalysisState): void {
  const sourceFile = declaration.getSourceFile();
  const text = sourceFile.text.slice(declaration.getStart(sourceFile), declaration.end);
  const key = `${normalPath(relative(repoRoot, sourceFile.fileName))}:${symbol}`;
  state.methods.set(key, { file: normalPath(relative(repoRoot, sourceFile.fileName)), symbol, sha256: sha256(text) });
  state.chunks.push(text);
}

function analyzeFunction(repoRoot: string, checker: ts.TypeChecker, value: ConcreteValue, methodName: string | undefined, state: AnalysisState): void {
  if (value.kind === "unresolved") { state.unresolved.add(value.reason); return; }
  if (value.kind === "scalar") return;
  if (value.kind === "database") return;
  let declaration: ts.FunctionLikeDeclaration | undefined;
  let symbol: string;
  let instance: ConcreteInstance | undefined;
  if (value.kind === "function") {
    declaration = value.declaration;
    symbol = value.typeName;
  } else {
    if (methodName === undefined) { state.unresolved.add(`METHOD_REQUIRED:${value.typeName}`); return; }
    declaration = methodDeclaration(value, methodName);
    symbol = `${value.typeName}.${methodName}`;
    instance = value;
    if (declaration === undefined) { state.unresolved.add(`METHOD_NOT_FOUND:${symbol}`); return; }
  }
  const key = `${nodeKey(declaration)}:${symbol}`;
  if (state.visited.has(key)) return;
  state.visited.add(key);
  recordMethod(repoRoot, declaration, symbol, state);
  if (declaration.body === undefined) { state.unresolved.add(`METHOD_BODY_MISSING:${symbol}`); return; }
  const localValues = new Map<string, ConcreteValue>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      localValues.set(node.name.text, resolveValue(checker, node.initializer));
    }
    if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(expression)) {
        const owner = unwrap(expression.expression);
        const calledMethod = expression.name.text;
        if (owner.kind === ts.SyntaxKind.ThisKeyword && instance !== undefined) {
          if (methodDeclaration(instance, calledMethod) !== undefined) analyzeFunction(repoRoot, checker, instance, calledMethod, state);
          else {
            const member = classMember(instance, calledMethod, checker);
            if (member === undefined) state.unresolved.add(`MEMBER_BINDING_MISSING:${instance.typeName}.${calledMethod}`);
            else analyzeFunction(repoRoot, checker, member, undefined, state);
          }
        } else if (ts.isPropertyAccessExpression(owner) && owner.expression.kind === ts.SyntaxKind.ThisKeyword && instance !== undefined) {
          const member = classMember(instance, owner.name.text, checker);
          if (member === undefined) state.unresolved.add(`CONSTRUCTOR_BINDING_MISSING:${instance.typeName}.${owner.name.text}`);
          else if (member.kind !== "database") analyzeFunction(repoRoot, checker, member, calledMethod, state);
        } else if (ts.isIdentifier(owner)) {
          const local = localValues.get(owner.text) ?? resolveValue(checker, owner);
          if (local.kind !== "database" && local.kind !== "scalar" && local.kind !== "unresolved") analyzeFunction(repoRoot, checker, local, calledMethod, state);
          else if (local.kind === "unresolved") {
            const declaration = symbolDeclaration(checker, expression.name);
            if (declaration?.getSourceFile().fileName.includes(`${sep}runtime${sep}src${sep}`)) state.unresolved.add(local.reason);
          }
        }
      } else if (ts.isIdentifier(expression)) {
        const declaration = symbolDeclaration(checker, expression);
        if (declaration !== undefined && declaration.getSourceFile().fileName.includes(`${sep}runtime${sep}src${sep}`)
          && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))) {
          analyzeFunction(repoRoot, checker, { kind: "function", declaration, typeName: expression.text }, undefined, state);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
}

function dependencyReferences(checker: ts.TypeChecker, routeCall: ts.CallExpression): Array<{ port: string; method?: string }> {
  const references = new Map<string, { port: string; method?: string }>();
  const visited = new Set<ts.Node>();
  const visit = (node: ts.Node): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "dependencies") {
      const port = node.name.text;
      let method: string | undefined;
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) method = parent.name.text;
      else if (ts.isCallExpression(parent) && parent.expression === node) method = "$call";
      else if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
        const chained = parent.parent;
        if (ts.isPropertyAccessExpression(chained) && ts.isCallExpression(chained.parent) && chained.parent.expression === chained) method = chained.name.text;
      }
      const key = `${port}.${method ?? "$value"}`;
      references.set(key, { port, ...(method === undefined ? {} : { method }) });
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const declaration = symbolDeclaration(checker, node.expression);
      if (declaration !== undefined && declaration.getSourceFile() === routeCall.getSourceFile()
        && (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body !== undefined) visit(declaration.body);
    }
    ts.forEachChild(node, visit);
  };
  let callback = routeCall.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
  if (callback === undefined && routeCall.arguments[0] !== undefined && ts.isObjectLiteralExpression(unwrap(routeCall.arguments[0]!))) {
    const handler = (unwrap(routeCall.arguments[0]!) as ts.ObjectLiteralExpression).properties.find((property) =>
      ts.isPropertyAssignment(property) && memberName(property.name) === "handler");
    if (handler !== undefined && ts.isPropertyAssignment(handler)) {
      const handlerValue = unwrap(handler.initializer);
      if (ts.isArrowFunction(handlerValue) || ts.isFunctionExpression(handlerValue)) callback = handlerValue;
    }
  }
  if (callback !== undefined) visit(callback);
  return [...references.values()].sort((left, right) => `${left.port}.${left.method}`.localeCompare(`${right.port}.${right.method}`));
}

function registrarBindings(checker: ts.TypeChecker, appSource: ts.SourceFile, registrar: string): Map<string, ts.Expression> | undefined {
  let result: Map<string, ts.Expression> | undefined;
  const visit = (node: ts.Node): void => {
    if (result !== undefined) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === registrar) {
      const object = node.arguments[1];
      if (object !== undefined && ts.isObjectLiteralExpression(unwrap(object))) {
        result = new Map<string, ts.Expression>();
        for (const property of (unwrap(object) as ts.ObjectLiteralExpression).properties) {
          if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) result.set(property.name.text, property.initializer);
          else if (ts.isShorthandPropertyAssignment(property)) {
            const valueSymbol = checker.getShorthandAssignmentValueSymbol(property);
            const declaration = valueSymbol?.valueDeclaration ?? valueSymbol?.declarations?.[0];
            if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
              result.set(property.name.text, declaration.initializer);
            } else result.set(property.name.text, property.name);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(appSource);
  return result;
}

function routeCallFor(source: ts.SourceFile, endpoint: HttpRouteSurfaceEntry): ts.CallExpression | undefined {
  let best: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "app") {
        const directMethod = expression.name.text.toUpperCase() === endpoint.method;
        const directPath = node.arguments[0] !== undefined && ts.isStringLiteralLike(unwrap(node.arguments[0]!))
          && (unwrap(node.arguments[0]!) as ts.StringLiteralLike).text === endpoint.path;
        if (directMethod && directPath) best = node;
        if (expression.name.text === "route" && node.arguments[0] !== undefined && ts.isObjectLiteralExpression(unwrap(node.arguments[0]!))) {
          const object = unwrap(node.arguments[0]!) as ts.ObjectLiteralExpression;
          const properties = new Map<string | undefined, ts.Expression>();
          for (const property of object.properties) {
            if (ts.isPropertyAssignment(property)) properties.set(memberName(property.name), unwrap(property.initializer));
            else if (ts.isShorthandPropertyAssignment(property)) properties.set(property.name.text, property.name);
          }
          const url = properties.get("url");
          const method = properties.get("method");
          const urlMatches = url !== undefined && ts.isStringLiteralLike(url) && url.text === endpoint.path;
          let methodMatches = method !== undefined && ts.isStringLiteralLike(method) && method.text.toUpperCase() === endpoint.method;
          if (!methodMatches && method !== undefined && ts.isIdentifier(method)) {
            for (let parent: ts.Node | undefined = node.parent; parent !== undefined; parent = parent.parent) {
              if (!ts.isForOfStatement(parent) || !ts.isVariableDeclarationList(parent.initializer)) continue;
              const declaration = parent.initializer.declarations[0];
              if (declaration === undefined || !ts.isIdentifier(declaration.name) || declaration.name.text !== method.text) continue;
              const values = unwrap(parent.expression);
              methodMatches = ts.isArrayLiteralExpression(values)
                && values.elements.some((entry) => ts.isStringLiteralLike(unwrap(entry as ts.Expression))
                  && (unwrap(entry as ts.Expression) as ts.StringLiteralLike).text.toUpperCase() === endpoint.method);
              break;
            }
          }
          if (urlMatches && methodMatches) best = node;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return best;
}

export function auditHttpRouteCompositionBindings(options: {
  repoRoot: string;
  runtimeRoot: string;
  endpoints: readonly HttpRouteSurfaceEntry[];
  knownSqlTables: ReadonlySet<string>;
}): HttpRouteCompositionBindingEvidence[] {
  // TypeScript follows local imports transitively. Seeding only the composition
  // root and route modules keeps this audit bounded to the binding closure.
  const rootNames = unique([
    resolve(options.runtimeRoot, "src/app.ts"),
    ...options.endpoints.map((endpoint) => resolve(options.runtimeRoot, endpoint.module)),
  ]).filter(existsSync);
  const program = ts.createProgram(rootNames, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const appSource = program.getSourceFile(resolve(options.runtimeRoot, "src/app.ts"));
  if (appSource === undefined) throw new Error("HTTP_COMPOSITION_APP_SOURCE_MISSING");
  const bindingsByRegistrar = new Map<string, Map<string, ts.Expression> | undefined>();
  const output: HttpRouteCompositionBindingEvidence[] = [];
  for (const endpoint of options.endpoints) {
    const source = program.getSourceFile(resolve(options.runtimeRoot, endpoint.module));
    const unresolved = new Set<string>();
    const state: AnalysisState = { methods: new Map(), chunks: [], unresolved, visited: new Set() };
    const routeCall = source === undefined ? undefined : routeCallFor(source, endpoint);
    if (source === undefined) unresolved.add("ROUTE_SOURCE_MISSING");
    if (routeCall === undefined) unresolved.add("ROUTE_CALL_NOT_FOUND");
    const references = routeCall === undefined ? [] : dependencyReferences(checker, routeCall);
    if (!bindingsByRegistrar.has(endpoint.registrar)) bindingsByRegistrar.set(endpoint.registrar, registrarBindings(checker, appSource, endpoint.registrar));
    const bindings = bindingsByRegistrar.get(endpoint.registrar);
    if (bindings === undefined) unresolved.add("REGISTRAR_COMPOSITION_BINDING_NOT_FOUND");
    const bindingTypes = new Set<string>();
    for (const reference of references) {
      if (reference.method === undefined || reference.method === "$value") continue;
      const expression = bindings?.get(reference.port);
      if (expression === undefined) { unresolved.add(`PORT_BINDING_NOT_FOUND:${reference.port}`); continue; }
      const value = resolveValue(checker, expression);
      bindingTypes.add(`${reference.port}:${value.typeName}`);
      analyzeFunction(options.repoRoot, checker, value, reference.method === "$call" ? undefined : reference.method, state);
    }
    if (references.filter(({ method }) => method !== undefined && method !== "$value").length === 0) unresolved.add("ROUTE_PERSISTENT_CALL_NOT_FOUND");
    const closure = state.chunks.join("\n");
    const read = unique([...closure.matchAll(SQL_READ)].map((match) => match[1]!).filter((table) => options.knownSqlTables.has(table)));
    const write = unique([...closure.matchAll(SQL_WRITE)].map((match) => match[1]!).filter((table) => options.knownSqlTables.has(table)));
    if (read.length === 0 && write.length === 0) unresolved.add("SQL_TARGET_CLOSURE_EMPTY");
    const core = {
      endpointKey: endpoint.key,
      registrar: endpoint.registrar,
      dependencyCalls: references.filter(({ method }) => method !== undefined).map(({ port, method }) => `${port}.${method}`).sort(),
      bindingTypes: [...bindingTypes].sort(),
      methodClosure: [...state.methods.values()].sort((left, right) => `${left.file}:${left.symbol}`.localeCompare(`${right.file}:${right.symbol}`)),
      observedSqlReadTables: read,
      observedSqlWriteTables: write,
      unresolvedReasons: [...unresolved].sort(),
    };
    output.push({ ...core, resolved: core.unresolvedReasons.length === 0, evidenceSha256: sha256(JSON.stringify(core)) });
  }
  return output.sort((left, right) => left.endpointKey.localeCompare(right.endpointKey));
}
