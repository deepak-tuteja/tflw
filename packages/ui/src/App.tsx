// U0: the shell exists and builds. U1 gives it a server to talk to; U2 gives it the project.
export function App() {
  return (
    <main style={{ padding: '1.5rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.1rem' }}>tflw</h1>
      <p style={{ color: 'var(--muted)' }}>the page for a .tflw project — nothing to show until a server serves it (M192 U1).</p>
    </main>
  );
}
