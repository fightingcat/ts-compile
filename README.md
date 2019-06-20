
# ts-compile

`ts-compile` is a tool for compiling non-modular typescript code into a modular or non-modular bundle file, and guarantee right dependency orders as much as possible.

## Installing

For npm user:

```bash
npm install -g ts-compile
```

For yarn user:

```bash
yarn global add ts-compile
```

## Usage

```bash
cd /YourProjectDir
ts-compile -c tsconfig.json -o built/bundle.js -m cjs
```

## Options

```
  -V, --version             # output the version number
  -h, --help                # output usage information
  -w, --watch               # compile in watch mode
  -c, --config <path>       # tsconfig file
  -o, --outFile <path>      # output file
  -m, --module [format]     # export top-level names (format: "esm", "cjs")
  -g, --global [namespace]  # export top-level names to a namespace
```
