// A project with no file in it — `M240` `A` (`D1309`), narrowed by `M254` (`D1402`).
//
// Until `M254` this drew per door: a door with no test behind it said *no test in this project does
// this yet*. There are no doors now, and `landingFor` answers `{ empty: true }` only when the project
// has no file at all — every other project opens on a file. So this is one sentence and the one
// gesture that changes the answer: `+ new file`, the same create dialog the explorer's footer opens,
// where the kind of test to scaffold is chosen (`D1399`).

export function EmptyDoor({ onNew }: { readonly onNew: () => void }) {
  return (
    <section className="empty-project" data-empty-door>
      <p>No test file here yet · make one to start</p>
      <button type="button" className="empty-project-new" data-empty-door-new onClick={onNew}>
        + new file
      </button>
    </section>
  );
}
