# Fixture: a served page that does not answer — red here, at the background fence

The command prints a page address, as `tflw ui --no-open` does, and nothing is listening behind it:

```sh runbook background
node -e "console.log('tflw ui — . at http://127.0.0.1:1/?token=abc123 (loopback only)'); setInterval(() => {}, 1000)" &
```

```text runbook-output
tflw ui — . at http://127.0.0.1:1/?token=abc123 (loopback only)
```
