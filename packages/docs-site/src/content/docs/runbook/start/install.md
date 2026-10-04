# 1. Install

This walkthrough takes one project from an empty directory to a green run in CI, in the order a
first day goes. The project is the **Coffee Shelf**: a small shop that `tflw init --example` writes
for you, with a test for every kind tflw runs: API, browser, load and scan. Every command on these
pages is run on every change to tflw, in a fresh directory, exactly as written here, so if one of
them does not do what the page says, that is a bug.

You need **Node 22 or newer**:

```sh runbook
node --version
```

## The package

<Published :when="false">

tflw is pre-1.0 and **not published to npm yet**, so the package is built from a clone and packed
on your machine. `npm pack` builds it first, then writes one `tflw-<version>.tgz` file, which is
exactly what npm will serve on 1.0 day:

```sh runbook-manual
git clone https://github.com/deepak-tuteja/tflw.git
cd tflw
npm ci
npm pack -w tflw
export TFLW_TGZ="$PWD/$(ls tflw-*.tgz)"
cd ..
```

That fence is the one exception to *every command is run*: the tree it would clone is the tree
being checked, so the check packs that tree itself and hands the tarball to the next fence as
`TFLW_TGZ`, the variable the fence above sets.

</Published>

Then make the project's directory, beside the clone:

```sh runbook
mkdir coffee-shelf && cd coffee-shelf
npm init -y
```

<Published :when="false">

```sh runbook
npm install -D "$TFLW_TGZ"
```

</Published>

<Published>

```sh runbook
npm install -D tflw
```

</Published>

## The browser

`playwright` is tflw's one optional peer, and it is needed only when a test opens a page. The
Coffee Shelf has 18 tests that do, so install it, then the browser it drives:

```sh runbook
npm install -D playwright
npx tflw install-browsers
```

`install-browsers` downloads Chromium into *that* `playwright`, the one your project imports, so the
browser and the library cannot disagree about versions. `--browser firefox` or `--browser webkit`
adds another engine. It never installs `playwright` itself: without the peer it refuses and says
how to add it.

```sh runbook
npx tflw --version
```

## You now have

A `coffee-shelf/` directory with a `package.json`, and `tflw` and `playwright` in its
`node_modules`. No test yet, and no config.

## Next, or instead

- **Next:** [2. The example](/runbook/start/example). The shop, and its tests.
- Upgrading later, and what `tflw doctor` tells you: [Installing tflw](/runbook/install).
- Every command and flag: [the CLI reference](/reference/cli).
