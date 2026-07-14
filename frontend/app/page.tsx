import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-page">
      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Immersive interview practice</p>
          <h1>AI Interview Simulator</h1>
          <p className="hero-text">
            Practice in a focused interview room with live voice, a working
            whiteboard, and a session report when the call ends.
          </p>
          <div className="hero-actions">
            <Link className="primary-action" href="/setup">
              Start setup
            </Link>
            <Link className="secondary-action" href="/reports">
              Interview history
            </Link>
            <Link className="secondary-action" href="/settings">
              API settings
            </Link>
          </div>
        </div>

        <div className="meeting-visual" aria-hidden="true">
          <div className="wall-screen">
            <span className="screen-light" />
            <span className="screen-line wide" />
            <span className="screen-line" />
            <span className="screen-line short" />
          </div>
          <div className="table">
            <div className="candidate-seat" />
            <div className="interviewer-seat" />
            <div className="notebook" />
          </div>
        </div>
      </section>

      <section className="flow-band" aria-label="Interview flow">
        <article>
          <span>01</span>
          <h2>Setup</h2>
          <p>Choose role, focus, duration, and interview style before entering.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Room</h2>
          <p>Practice inside a meeting-room interface, not a chat window.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Report</h2>
          <p>Review your answers, transcript, and practical next steps.</p>
        </article>
      </section>
    </main>
  );
}
