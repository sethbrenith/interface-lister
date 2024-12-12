import * as ts from "typescript";
import * as fs from "fs";
import {ArrayMultimap} from '@teppeis/multimaps';

interface Location {
  fileName: string;
  position: number;
}

interface Interface {
  name: string;
  properties: string[];
  location: Location;
}

// Generates an interface list for all interfaces in a set of .ts files.
function listInterfaces(
  fileNames: string[],
  options: ts.CompilerOptions
): void {
  const program = ts.createProgram(fileNames, options);
  const checker = program.getTypeChecker();
  const interfaces: Interface[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    ts.forEachChild(sourceFile, accumulateInterfaces);
  }

  // Now we've created a list of interfaces, but there could be two kinds of
  // duplication:
  //
  // 1. interfaces with the same name
  // 2. interfaces with the same property list
  //
  // We'll deal with both of those cases below. First, we'll check for matching
  // property lists. For example, if there are interfaces named X, X, Y, and Z
  // which all have the same properties, then we'll invent a new interface name
  // "X|Y|Z".
  const mapByProperties: ArrayMultimap<string, Interface> = new ArrayMultimap();
  for (const i of interfaces) {
    i.properties.sort();
    mapByProperties.put(JSON.stringify(i.properties), i);
  }
  interfaces.length = 0;
  const mapByName: ArrayMultimap<string, Interface> = new ArrayMultimap();
  for (const properties of mapByProperties.keys()) {
    const interfaces = mapByProperties.get(properties);
    // Choose one from the matching group to be the "primary". Without any clear
    // indication of which one matters more to the programmer, we'll just choose
    // the first one.
    const primaryInterface = interfaces[0];
    // Generate a name including the names of all matching interfaces.
    if (interfaces.length > 1) {
      const namesSet: Set<string> = new Set();
      for (const i of interfaces) {
        namesSet.add(i.name);
      }
      const names = Array.from(namesSet);
      names.sort();
      primaryInterface.name = names.join('|');
    }
    mapByName.put(primaryInterface.name, primaryInterface);
  }
  mapByProperties.clear();
  // Next, we'll handle the case where multiple interfaces with different
  // properties have the same name, by appending location information to invent
  // new unique names.
  const result: {[name: string]: string[]} = Object.create(null);
  for (const name of mapByName.keys()) {
    const interfaces = mapByName.get(name);
    for (const i of interfaces) {
      const key = interfaces.length === 1 ? i.name :
          `${i.name} from ${i.location.fileName}:${i.location.position}`;
      result[key] = i.properties;
    }
  }

  fs.writeFileSync("interfaces.json", JSON.stringify(result, undefined, 2));
  return;

  function accumulateInterfaces(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const c = readInterface(symbol, node);
        if (c && c.properties.length > 0) interfaces.push(c);
      }
    }
    ts.forEachChild(node, accumulateInterfaces);
  }

  function readInterface(symbol: ts.Symbol, node: ts.InterfaceDeclaration) {
    const result: Interface = {
      name: symbol.getName(),
      properties: [],
      location: {
        fileName: node.getSourceFile().fileName,
        position: node.pos,
      },
    }

    const type = checker.getTypeAtLocation(node);

    // This iteration includes inherited properties. It does not include index
    // properties such as `[x:string]:number;`, which we couldn't use anyway.
    for (const property of type.getProperties()) {
      // Skip optional properties, since they might not be present at runtime.
      if (property.getFlags() & ts.SymbolFlags.Optional) {
        continue;
      }

      // Property names in heap snapshots are represented as strings, which
      // means that we don't have a good way to check whether a property is
      // included when the property key is a unique symbol. We'll skip emitting
      // interface definitions for interfaces that use symbols.
      if (isSymbolProperty(property)) {
        return undefined;
      }

      const name = property.getName();

      // 'Array index' properties are stored differently, and DevTools does not
      // check for them when categorizing interfaces. To avoid accidentally
      // classifying an object as implementing an interface that it does not, we
      // should avoid emitting anything for interfaces with such properties.
      const num = parseInt(name, 10);
      if (num >= 0 && num <= 2**32 - 2 && '' + num === name) {
        return undefined;
      }

      result.properties.push(name);
    }

    return result;
  }

  // Returns whether the property's key is a symbol, rather than a string.
  function isSymbolProperty(property: ts.Symbol) {
    // checker.getTypeOfSymbol(property) would give the type of the property
    // value, but we want the type of the property key, so some more steps are
    // required. We'll try to find out whether the property key is defined in
    // brackets, and if the expression within the brackets is a symbol.
    const declaration = property.declarations?.at(0);
    // The computed property name might not be the first child; there could be
    // other keywords first such as 'readonly'. Instead, we must iterate the
    // child nodes.
    for (const child of declaration?.getChildren() ?? []) {
      if (child.kind === ts.SyntaxKind.ComputedPropertyName) {
        // The child at index 0 in a ComputedPropertyName is the left bracket
        // token, and the child at index 1 is the expression within the
        // brackets.
        const keyExpression = child.getChildAt(1);
        const keyType = checker.getTypeAtLocation(keyExpression);
        return checker.isTypeAssignableTo(keyType, checker.getESSymbolType());
      }
    }
    return false;
  }
}

listInterfaces(process.argv.slice(2), {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.CommonJS,
});

// -----------------------------------------------------------------------------

// The following interface definitions are some test cases.
// To test this file on itself:
//   tsc interface-lister.ts --m commonjs --target esnext
//   node interface-lister.js interface-lister.ts

interface BaseInterface {
  x: number;
}

// This interface will include the inherited property 'x'.
interface InheritedInterface extends BaseInterface {
  y: number;

  // Optional properties are omitted.
  z?: string;

  // Properties which must be present, even if they could be undefined, are
  // included.
  w: any;
  q: BaseInterface|undefined;

  ['meow']: number;
  '""/@#$%^&': 0;

  // 'get' and 'set' properties don't necessarily indicate that the properties
  // must be implemented as getters or setters, just that get and set operations
  // are possible, so we'll treat those like normal properties.
  get f(): BaseInterface;
  g(): void;
  set h(h: number);
}

export interface Foo {
  foo: number;
  // Indexed properties are omitted.
  [x: string]: number;
}

const symbol: unique symbol = Symbol();

// The following two interfaces are ignored because we don't have a good
// strategy for dealing with symbol equality.

export interface WithSymbols1 {
  readonly [symbol]: 'hi';
}

export interface WithSymbols2 {
  x: number;
  [Symbol.species]: number;
}

// The blocks below exercise the two kinds of duplication that can be found:
// matching names and matching property lists.

{
  interface RepeatedName {
    aaa: string;
    bbb: string;
    ccc: string;
  }

  interface MatchingProperties1 {
    fff: string;
    ggg: string;
    hhh: string;
  }

  interface RepeatedNameWithMatchingProperties {
    iii: string;
    jjj: string;
  }
}

{
  interface RepeatedName {
    ddd: number;
    eee: number;
  }

  interface MatchingProperties2 {
    hhh: number;
    ggg: number;
    fff: number;
  }

  interface RepeatedNameWithMatchingProperties {
    jjj: number;
    iii: number;
  }
}

{
  interface NotRepeatedNameWithMatchingProperties {
    iii: undefined;
    jjj: null;
  }
}
