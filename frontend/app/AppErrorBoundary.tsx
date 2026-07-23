"use client";

import Link from "next/link";
import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled application error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="page-shell error-fallback">
        <section>
          <p className="eyebrow">The room hit an unexpected error</p>
          <h1>Your saved setup and interview history are still on this device.</h1>
          <p>
            Reload the current page to recover, or return to setup and start a
            fresh session.
          </p>
          <div className="session-actions">
            <button
              className="primary-action"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload page
            </button>
            <Link className="secondary-action" href="/setup">
              Return to setup
            </Link>
          </div>
        </section>
      </main>
    );
  }
}
