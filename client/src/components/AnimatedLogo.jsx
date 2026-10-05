import logo from "../assets/landing-logo.svg";

/**
 * The Aux Wars logo with a slow pulse (CSS .logo-pulse in index.css; off
 * under prefers-reduced-motion).
 *
 * @returns {JSX.Element} Rendered component
 */
export default function AnimatedLogo() {
  return (
    <img
      data-testid="animated-logo"
      className="landing-logo logo-pulse p-6 md:p-12 w-64 h-32 md:w-auto md:h-auto object-contain"
      src={logo}
      alt="Aux Wars Logo"
    />
  );
}
