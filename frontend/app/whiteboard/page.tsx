import Link from "next/link";
import WhiteboardCanvas from "./WhiteboardCanvas";

export default function WhiteboardPage() {
  return (
    <main className="whiteboard-page">
      <header className="whiteboard-topbar">
        <div>
          <Link className="meeting-brand" href="/">
            AI Interview Simulator
          </Link>
          <span>Interview Whiteboard</span>
        </div>
        <nav aria-label="Whiteboard navigation">
          <Link href="/interview">Back to room</Link>
          <Link href="/report">Report</Link>
        </nav>
      </header>

      <section className="whiteboard-shell">
        <aside className="whiteboard-info">
          <p className="eyebrow">Live workspace</p>
          <h1>Shared whiteboard</h1>
          <p>
            Draw, diagram, and take notes while the interview room remains open.
          </p>
          <div className="snapshot-status">
            <span className="live-dot" />
            Autosaved locally · snapshots shared with interviewer
          </div>
        </aside>

        <WhiteboardCanvas />
      </section>
    </main>
  );
}
