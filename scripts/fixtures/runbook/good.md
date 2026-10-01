# Fixture: the unchanged page — green, and it exercises what the gate promises

```sh runbook
npx tflw init
```

```text runbook-output
created tflw.config, example.tflw, .env.example, .gitignore

next:
  tflw run
```

```sh runbook
npx tflw check
```

```text runbook-output
1 file checked, no problems found.
```

A `cd` and an `export` hold for the next fence, as they do in a reader's terminal:

```sh runbook
mkdir -p sub && cd sub && export GREETING=hello
```

```sh runbook
basename "$PWD"
echo "$GREETING"
```

```text runbook-output
sub
hello
```

A background command is waited for until it prints what the page says, and stopped at the end:

```sh runbook background
node -e "setTimeout(() => console.log('up on http://127.0.0.1:' + new URL(process.env.SHOP_URL).port), 300); setInterval(() => {}, 1000)" &
```

```text runbook-output
up on http://127.0.0.1:4720
```

`…` elides any run of lines:

```sh runbook
printf 'one\ntwo\nthree\n'
```

```text runbook-output
one
…
three
```
