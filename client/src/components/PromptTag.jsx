
/**
 * PromptTag component displays a selectable prompt tag with different styles for selected/unselected states.
 * 
 * @param {Object} props - Component props
 * @param {string} props.label - Text to display in the tag
 * @param {boolean} props.selected - Whether the tag is currently selected
 * @param {Function} props.onClick - Callback when the tag is clicked
 * @returns {JSX.Element} Rendered component
 */
export default function PromptTag({ label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-sm border transition-all ${
        selected
          ? "green-btn text-black font-semibold border-green-500"
          : "bg-[#242424] text-gray-300 border-gray-600 hover:bg-[#1a1a1a] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
