import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * ErrorBoundary component catches React errors in child components
 * and displays a fallback UI instead of crashing the entire app.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details for debugging
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-[#121212] text-white">
          <div className="max-w-md text-center p-8">
            <h1 className="text-3xl font-bold mb-4">Oops! Something went wrong</h1>
            <p className="text-gray-400 mb-6">
              The game encountered an unexpected error. This shouldn't happen often!
            </p>
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              className="green-btn rounded-full py-2 px-8 text-black font-semibold"
            >
              Return to Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
