import React from "react";

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Prevents a thrown exception during render
 * (e.g. a bad IDL passed to `new Program(...)`) from unmounting the entire
 * React tree and leaving a blank page.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Unhandled render error:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
        <div className="max-w-xl w-full card">
          <div className="card-header text-red-400">Something went wrong</div>
          <p className="text-sm text-gray-400 mb-3">
            The UI crashed while rendering. This is usually a client-side bug,
            not an on-chain issue.
          </p>
          <pre className="text-xs text-red-300 bg-gray-900/60 border border-red-500/20 rounded-md p-3 overflow-auto whitespace-pre-wrap">
            {error.message}
          </pre>
          <button
            className="btn-outline mt-4"
            onClick={() => this.setState({ error: null })}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
}
