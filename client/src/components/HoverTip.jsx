/**
 * A small label under a control on hover or keyboard focus, for icon-only
 * buttons. Desktop only: the label is never shown on touch screens (see
 * .hover-tip in index.css). The control keeps its own aria-label; the label
 * is hidden from assistive tech so it is not read twice.
 *
 * @param {Object} props
 * @param {string} props.label - The text to show
 * @param {"center"|"start"} [props.align="center"] - "start" lines the label up with the control's left edge
 * @param {React.ReactNode} props.children - The control
 */
export default function HoverTip({ label, align = "center", children }) {
  return (
    <span className="has-tip relative inline-flex">
      {children}
      <span aria-hidden="true" className={`hover-tip ${align === "start" ? "tip-start" : "tip-center"}`}>
        {label}
      </span>
    </span>
  );
}
