# Fixture: the install every control starts from

`verify-runbook.mjs --self-test` runs this page first in every case, so each control is one page
read after a directory that already has tflw in it.

```sh runbook-manual
git clone https://example.invalid/tflw.git   # the one fence a gate cannot run: counted, not skipped
```

```sh runbook
npm init -y > /dev/null
npm install -D "$TFLW_TGZ" --no-audit --no-fund > /dev/null
```
