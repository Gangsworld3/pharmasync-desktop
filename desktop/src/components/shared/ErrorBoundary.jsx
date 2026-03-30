import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Renderer error boundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card danger">
          <h3>UI Error</h3>
          <p>Something went wrong: {this.state.error?.message ?? "Unknown renderer failure"}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
