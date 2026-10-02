import { Component, type ReactNode } from 'react';
import { Button } from './ui';

/** Keeps a bug in one page from blanking the app; never shows raw errors to the student. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('UI error', error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h2 className="text-lg font-semibold">This page hit a problem</h2>
        <p className="mt-2 text-sm text-ink-2">Your data is safe on this device. Try reloading, or open another page.</p>
        <Button className="mt-4" variant="primary" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
