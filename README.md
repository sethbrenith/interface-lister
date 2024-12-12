# interface-lister

A proof of concept for generating an *interface definition file* as proposed in [Custom interface names in heap snapshots](https://docs.google.com/document/d/1DqDeTbyaqYsuZRksm2LXTGT7d4b2uWAhAvevKpd9K7c/edit)

## Background

Chromium DevTools provides a powerful tool to inspect a *heap snapshot*, which is a list of all the JavaScript objects allocated by a web page or Node.js application. There are far too many objects in an application for a flat list to be meaningful, so DevTools categorizes them. It currently categorizes JavaScript objects in two ways:

1. By constructor, for objects created with `new` or those with special built-in types such as functions and regular expressions.
2. By the names of the properties in the object, for objects with the default `Object` constructor. For example, if the application has many objects with properties named `x` and `y`, then DevTools will create a category named `{x, y}` for those objects.

## Overview of this project

Your Typescript code probably has more meaningful interface names than those generated by the DevTools heap snapshot viewer. The code in this repository is a rough first attempt at generating an *interface definition file* from Typescript source code, which DevTools could (in the future) use when categorizing a heap snapshot. An interface definition file is JSON and looks something like this:

```json
{
  "Point2D": ["x", "y"],
  "Size2D": ["width", "height"]
}
```

With that interface definition file, any object with properties `x` and `y` would be categorized as `Point2D`, and any object with properties `width` and `height` would be categorized as `Size2D`. All other plain JS objects would be categorized as `Object`.

## Limitations

1. The categorization in DevTools is based on the *presence* of named properties, not the types of the values stored in those properties. This can still be useful, but is far from the rich type system you're used to in Typescript.
2. DevTools ignores properties whose names are [array indexes](https://tc39.es/ecma262/#array-index) when categorizing objects, so this project avoids emitting anything for interfaces that declare such properties. These are rare in the code I've seen.
3. DevTools can't check reference equality for any property whose key is a `Symbol` rather than a string, so this project avoids emitting interfaces that use symbols.