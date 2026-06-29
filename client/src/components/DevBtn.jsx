
/**
 * DevBtn component displays Wilson's developer credit.
 * 
 * @returns {JSX.Element} Rendered component
 */
export default function DevBtn() {
  return (
    <a 
      href="https://github.com/wkoverfield" 
      target="_blank" 
      rel="noopener noreferrer"
      className="dev-btn flex rounded-full items-center justify-center cursor-pointer"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 mr-1">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
      <p className="text-xs">Wilson Overfield</p>
    </a>
  );
} 