---
pageClass: grammar-page
---

# Grammar

What you can write in a `.tflw` file and in `tflw.config`, section by section. Each section opens
with the forms as you would type them; the formal productions and the rules behind them follow,
folded.

The productions are
[`packages/lang/GRAMMAR.md`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/GRAMMAR.md),
and every one of them is on this page. A test fails the build when the parser recognises a keyword
that file has no production for. Cross-references inside the productions are `(§n)` for a section of
[SPEC.md](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md), and `(P#n)`, `(D<n>)` and
`(M<n>)` for the decision or milestone behind a rule; each resolves in
[DECISIONS.md](https://github.com/deepak-tuteja/tflw/blob/main/DECISIONS.md).

<!--@include: ../../../../lang/GRAMMAR.md-->
