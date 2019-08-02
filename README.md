
# ts-compile

`ts-compile` is a tool for compiling non-modular typescript code into a modular or non-modular bundle file, and guarantee right dependency orders as much as possible.

## Installing

For npm users:

```bash
npm install -g ts-compile
```

For yarn users:

```bash
yarn global add ts-compile
```

## Usage

```bash
cd /YourProjectDir
ts-compile -p tsconfig.json -o built/bundle.js -m cjs
```

## Options

```
  -V, --version                   # output the version number
  -h, --help                      # output usage information
  -w, --watch                     # compile in watch mode
  -p, --project <path>            # tsconfig file
  -o, --bundleOutput <path>       # output file
  -m, --bundleModule [format]     # export top-level names (format: "es6", "commonjs")
  -g, --bundleGlobal [namespace]  # export top-level names to a namespace
```

## Example

### Step1:

Create a config file `tsconfig.json`:

```json
{
    "compilerOptions": {
        "module": "none",
        "target": "es6",
        "declaration": true,
        "outFile": "built/bundle.js"
    },
    "include": ["src"]
}
```

### Step2:

Create a typescript source file `src/a.ts`:

```typescript
class A extends B { }
```

### Step3:

Create another source file `src/b.ts`:

```typescript
class B { }
```

### Step4:

Compile with `tsc`:

```bash
tsc -p tsconfig.json
```

> Will see caution: `src/a.ts:1:17 - error TS2449: Class 'B' used before its declaration.`

Output:

```javascript
// built/bundle.js:
class A extends B {
}
class B {
}
```

```typescript
// built/bundle.d.ts
declare class A extends B {
}
declare class B {
}
```

Class A precede class B, that will cause a runtime error.

### Step5:

Compile with `ts-compile`

```bash
ts-compile -p tsconfig.json -o built/bundle.js
```

Output:

```javascript
// built/bundle.js
class B {
}
class A extends B {
}
```

```typescript
// built/bundle.d.ts
declare class A extends B {
}
declare class B {
}
```

Class B precede class A, no runtime error.

### Step6:

Compile into a module with `ts-compile`

```
ts-compile -p tsconfig.json -o built/bundle.js -m cjs
```

Output:

```javascript
// built/bundle.js
class B {
}
module.exports.B = B;
class A extends B {
}
module.exports.A = A;
```

```typescript
// built/bundle.d.ts
export declare class A extends B {
}
export declare class B {
}
```

Class B precede class A, no runtime error.

It's worth to mention that vscode will claim error `TS2449`, if the compiler option `outFile` in `tsconfig.json` is set, so it's better to leave it unset, and execute `ts-compile` with option `--output`.
