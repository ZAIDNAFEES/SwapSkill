import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends (Component as any) {
  public state: State;
  public props: Props;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary caught an unhandled runtime error]:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    try {
      window.location.reload();
    } catch (_) {
      window.location.href = "/";
    }
  };

  private handleReset = () => {
    try {
      // Clear transient state that might be causing a render crash loop
      sessionStorage.clear();
    } catch (_) {}
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          id="root-error-boundary-screen"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-neutral-900 text-neutral-100 px-6 py-8 select-none"
          style={{ minHeight: "100vh" }}
        >
          <div className="max-w-md w-full flex flex-col items-center text-center">
            {/* Warning Icon Graphic */}
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-6 shadow-lg shadow-amber-500/5">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
            </div>

            {/* Error Message */}
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
              Something went wrong
            </h1>
            <p className="text-neutral-400 text-sm leading-relaxed mb-8 max-w-sm">
              The application encountered an unexpected issue. Please reload to resume your session seamlessly.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs">
              <button
                id="error-boundary-reload-btn"
                onClick={this.handleReload}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-sm transition-all duration-150 shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Application</span>
              </button>

              <button
                id="error-boundary-reset-btn"
                onClick={this.handleReset}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-800 text-neutral-300 font-medium text-sm transition-all duration-150 border border-neutral-700/60 cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>Reset & Home</span>
              </button>
            </div>

            {/* Technical Detail Collapsible (for debugging) */}
            {process.env.NODE_ENV !== "production" && this.state.error && (
              <details className="mt-8 w-full text-left bg-neutral-950/60 rounded-xl p-4 border border-neutral-800 text-xs text-neutral-400 font-mono overflow-auto max-h-48">
                <summary className="cursor-pointer text-neutral-300 font-medium mb-2">
                  Technical Diagnostics
                </summary>
                <p className="text-rose-400 font-semibold mb-1">
                  {this.state.error.name}: {this.state.error.message}
                </p>
                {this.state.error.stack && (
                  <pre className="whitespace-pre-wrap text-[11px] leading-tight text-neutral-500">
                    {this.state.error.stack}
                  </pre>
                )}
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
