<template>
  <div class="hero-code-panel">
    <p class="hero-code-label">checkout.tflw</p>
    <pre class="hero-code"><code><span class="tok-kw">test</span> <span class="tok-str">"user can check out"</span> <span class="tok-kw">as</span> shopper
  <span class="tok-kw">let</span> email = <span class="tok-kw">unique</span> email
  <span class="tok-kw">api</span> <span class="tok-kw">POST</span> /cart/checkout body { email: {email} }
  <span class="tok-kw">expect</span> status <span class="tok-kw">equals</span> 201
  <span class="tok-kw">capture</span> body.orderId <span class="tok-kw">as</span> orderId
  <span class="tok-kw">log</span> <span class="tok-str">"order {orderId} placed, confirming delivery"</span>

  <span class="tok-kw">open</span> <span class="tok-str">"/orders/{orderId}"</span>
  <span class="tok-kw">click</span> button <span class="tok-str">"Confirm delivery"</span>
  <span class="tok-kw">expect</span> text <span class="tok-str">"Order confirmed"</span> <span class="tok-kw">is</span> visible

  <span class="tok-cm"># same file, confirming the backend saw it too</span>
  <span class="tok-kw">api</span> <span class="tok-kw">GET</span> /orders/{orderId}
  <span class="tok-kw">expect</span> body.status <span class="tok-kw">equals</span> <span class="tok-str">"confirmed"</span>

<span class="tok-cm"># and the same grammar covers load testing</span>
<span class="tok-kw">test</span> <span class="tok-str">"checkout under load"</span>
  <span class="tok-kw">ramp</span> <span class="tok-kw">to</span> 50 users <span class="tok-kw">over</span> 30s
  <span class="tok-kw">api</span> <span class="tok-kw">POST</span> /cart/checkout body { id: <span class="tok-str">"widget-1"</span> }
  <span class="tok-kw">expect</span> status <span class="tok-kw">equals</span> 201
  <span class="tok-kw">threshold</span> p95 duration <span class="tok-kw">is</span> <span class="tok-kw">less</span> <span class="tok-kw">than</span> 800ms</code></pre>
  </div>
</template>
